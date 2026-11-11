/**
 * The collector process: one per data directory, holding run/collector.pid.
 * It imports the spool when files arrive (fs.watch, with a polling fallback
 * because watchers can miss events), sweeps session status on a timer, and
 * serves the dashboard and API on 127.0.0.1.
 */
import { watch, type FSWatcher } from 'node:fs';
import { checkHookInstall } from '@stillwatch/installer';
import { stillwatchPaths, type HookInstallStatus, type StatusResponse } from '@stillwatch/schema';
import { ensureDataDirs } from './config';
import { defaultDeps, type PipelineDeps } from './deps';
import { describeError } from './fs-safe';
import { acquirePidLock, releasePidLock, updatePidLock } from './pidfile';
import type { Pipeline, PipelineOptions } from './pipeline';
import { buildPipeline, type PipelineInternal } from './pipeline-core';
import { startHttpServer, type HttpServerHandle } from './server';
import { listSpool } from './spool';

export type CollectorOptions = PipelineOptions & {
  /** Default: config.port. 0 picks a free port (tests). */
  port?: number;
  /** Directory with the built dashboard (index.html, assets/). `null` serves a short notice instead. */
  webRoot: string | null;
  version: string;
};

export type CollectorHandle = {
  readonly port: number;
  readonly pipeline: Pipeline;
  stop(): Promise<void>;
};

/** Pending spool files older than this are reported as a warning. */
const BACKLOG_WARN_MS = 5 * 60_000;
const STATUS_GAPS = 20;

/**
 * Starts the collector in this process: takes the single-instance lock
 * (run/collector.pid), binds 127.0.0.1 only, watches the spool, runs timers,
 * and serves the API through `startHttpServer` from ./server.
 * Rejects if another live collector holds the lock.
 */
export function runCollector(options: CollectorOptions): Promise<CollectorHandle> {
  return runCollectorWith(options, defaultDeps());
}

/** `runCollector` with injectable dependencies, for tests. */
export async function runCollectorWith(
  options: CollectorOptions,
  deps: PipelineDeps,
): Promise<CollectorHandle> {
  const now = options.now ?? Date.now;
  const paths = stillwatchPaths(options.stillwatchHome);
  await ensureDataDirs(options.stillwatchHome);
  const pid = process.pid;
  const startedAt = now();
  await acquirePidLock(paths.pidFile, { pid, port: null, startedAt });

  let pipeline: PipelineInternal | null = null;
  let server: HttpServerHandle | null = null;
  try {
    pipeline = await buildPipeline(options, deps);
    const p = pipeline;
    server = await startHttpServer({
      store: p.store,
      config: p.config,
      version: options.version,
      webRoot: options.webRoot,
      port: options.port ?? p.config.port,
      logger: p.logger,
      now: p.now,
      userHome: p.userHome,
      getStatus: () => buildStatus(p, options.version, { pid, startedAt, port: server?.port ?? 0 }),
      requestAnalysis: (sessionId) => {
        p.requestAnalysis(sessionId);
      },
      onSessionDeleted: (sessionId) => {
        p.forgetSession(sessionId);
      },
    });
    await updatePidLock(paths.pidFile, { pid, port: server.port, startedAt });
  } catch (err) {
    await server?.close().catch(() => undefined);
    await pipeline?.close().catch(() => undefined);
    await releasePidLock(paths.pidFile, pid).catch(() => undefined);
    throw err;
  }

  const p = pipeline;
  const http = server;
  const log = (what: string) => (err: unknown) => {
    p.logger.error(`${what} failed`, { error: describeError(err) });
  };
  const importNow = (): void => {
    p.importOnce().catch(log('spool import'));
  };
  const sweepNow = (): void => {
    p.sweep().catch(log('sweep'));
  };

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(paths.spoolNew, { persistent: false }, importNow);
    watcher.on('error', (err) => {
      p.logger.warn('spool watcher failed; polling only', { error: describeError(err) });
      watcher?.close();
      watcher = null;
    });
  } catch (err) {
    p.logger.warn('spool watcher unavailable; polling only', { error: describeError(err) });
  }
  const pollTimer = setInterval(importNow, p.timing.spoolPollMs);
  const sweepTimer = setInterval(sweepNow, p.timing.sweepIntervalMs);
  pollTimer.unref();
  sweepTimer.unref();
  p.logger.info('collector started', { pid, port: http.port });
  importNow();
  sweepNow();

  let stopping: Promise<void> | null = null;
  return {
    port: http.port,
    pipeline: p,
    stop() {
      stopping ??= (async () => {
        clearInterval(pollTimer);
        clearInterval(sweepTimer);
        watcher?.close();
        watcher = null;
        await http.close().catch(log('closing the server'));
        p.logger.info('collector stopped', { pid });
        await p.close().catch(log('closing the pipeline'));
        await releasePidLock(paths.pidFile, pid).catch(() => undefined);
      })();
      return stopping;
    },
  };
}

const UNKNOWN_HOOKS: HookInstallStatus = {
  installed: false,
  scope: null,
  settingsPath: null,
  events: [],
  missing: [],
  outdated: [],
  hookScriptOk: false,
  claudeVersion: null,
  compatible: null,
};

async function buildStatus(
  p: PipelineInternal,
  version: string,
  collector: StatusResponse['collector'],
): Promise<StatusResponse> {
  const warnings: string[] = [];
  const pending = await listSpool(p.paths.spoolNew).catch(() => []);
  let oldestAt: number | null = null;
  for (const entry of pending)
    oldestAt = oldestAt === null ? entry.receivedAt : Math.min(oldestAt, entry.receivedAt);
  if (oldestAt !== null && p.now() - oldestAt > BACKLOG_WARN_MS) {
    warnings.push(`${pending.length} hook events have waited more than 5 minutes to be imported.`);
  }
  let hooks = UNKNOWN_HOOKS;
  try {
    hooks = await checkHookInstall(p.config);
  } catch (err) {
    p.logger.warn('checking the hook install failed', { error: describeError(err) });
    warnings.push('The hook install could not be checked.');
  }
  if (!hooks.installed)
    warnings.push('Stillwatch hooks are not installed. Run `stillwatch install`.');
  else if (hooks.missing.length > 0)
    warnings.push(`Hooks are missing for: ${hooks.missing.join(', ')}.`);
  else if (hooks.outdated.length > 0)
    warnings.push(
      `Hooks are from an older version for: ${hooks.outdated.join(', ')}. Run 'stillwatch install' again.`,
    );
  const counts = p.store.counts();
  return {
    version,
    collector,
    spool: { pending: pending.length, oldestAt, failedTotal: p.failedTotal() },
    db: {
      path: p.paths.db,
      sizeBytes: counts.sizeBytes,
      sessions: counts.sessions,
      events: counts.events,
    },
    hooks,
    lastEventAt: p.store.lastEventAt(),
    retentionDays: p.config.retentionDays,
    gaps: p.store
      .getGaps(null)
      .filter((g) => g.sessionId === null)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, STATUS_GAPS),
    warnings,
  };
}

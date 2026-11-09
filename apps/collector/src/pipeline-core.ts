/**
 * Builds a pipeline from injectable dependencies. Imports run one at a time
 * (concurrent requests coalesce into one follow-up run). Analysis, sweeps,
 * and on-demand re-analysis share a second serial lane, so sessions are
 * analyzed sequentially and never while a sweep changes their status.
 */
import { homedir } from 'node:os';
import { stillwatchPaths, type StillwatchPaths } from '@stillwatch/schema';
import { Analyzer } from './analyzer';
import { ensureDataDirs, loadOrCreateConfig } from './config';
import {
  currentPlatform,
  resolveTiming,
  SerialLane,
  type PipelineContext,
  type Timing,
} from './context';
import type { PipelineDeps } from './deps';
import { describeError } from './fs-safe';
import { Importer } from './importer';
import { createFileLogger, type FileLogger } from './logger';
import type { ImportStats, Pipeline, PipelineOptions } from './pipeline';
import { DebounceScheduler } from './scheduler';
import { SnapshotManager } from './snapshots';
import { sweep } from './sweep';
import type { Logger } from './types';

/** A busy session is analyzed at least this many debounce periods after its first new event. */
const MAX_WAIT_FACTOR = 10;

/** The pipeline plus what the collector process needs internally. */
export type PipelineInternal = Pipeline & {
  readonly logger: Logger;
  readonly paths: StillwatchPaths;
  readonly userHome: string;
  readonly timing: Timing;
  readonly now: () => number;
  /** Spool records discarded since start. */
  failedTotal(): number;
  /** Marks a session for analysis and analyzes it after the debounce delay. */
  requestAnalysis(sessionId: string): void;
  /** Drops in-memory state for a deleted session. */
  forgetSession(sessionId: string): void;
};

export async function buildPipeline(
  options: PipelineOptions,
  deps: PipelineDeps,
): Promise<PipelineInternal> {
  const now = options.now ?? Date.now;
  const paths = stillwatchPaths(options.stillwatchHome);
  await ensureDataDirs(options.stillwatchHome);
  const config = await loadOrCreateConfig(options.stillwatchHome, now());
  let ownedLogger: FileLogger | null = null;
  let logger: Logger;
  if (options.logger) {
    logger = options.logger;
  } else {
    ownedLogger = createFileLogger({ file: paths.logFile, now });
    logger = ownedLogger;
  }

  const store = deps.openStore({ path: paths.db, now });
  let ctx: PipelineContext;
  try {
    ctx = {
      stillwatchHome: options.stillwatchHome,
      paths,
      userHome: options.userHome ?? homedir(),
      includeSystemSurface: options.includeSystemSurface ?? true,
      platform: currentPlatform(),
      now,
      logger,
      gitBinary: options.gitBinary,
      timing: resolveTiming(options.timing),
      deps,
      store,
      config,
      redactor: deps.createRedactor({ fingerprintKey: config.fingerprintKey }),
    };
  } catch (err) {
    store.close();
    ownedLogger?.close();
    throw err;
  }

  const snapshots = new SnapshotManager(ctx);
  const analyzer = new Analyzer(ctx, snapshots);
  const analysisLane = new SerialLane();
  let closed = false;

  const runAnalysis = (sessionId: string): void => {
    if (closed) return;
    void analysisLane.run(() => analyzer.analyzeOne(sessionId));
  };
  const scheduler = new DebounceScheduler(
    ctx.timing.analysisDebounceMs,
    ctx.timing.analysisDebounceMs * MAX_WAIT_FACTOR,
    runAnalysis,
    now,
  );
  const importer = new Importer(ctx, snapshots, (ids) => {
    for (const id of ids) scheduler.schedule(id);
  });

  let importChain: Promise<unknown> = Promise.resolve();
  let queuedImport: Promise<ImportStats> | null = null;

  const forgetSession = (sessionId: string): void => {
    scheduler.cancel(sessionId);
    snapshots.forget(sessionId);
    analyzer.forget(sessionId);
  };

  /** Drops in-memory snapshot state of sessions that are gone or closed. */
  const prune = (): void => {
    for (const id of snapshots.tracked()) {
      const session = store.getSession(id);
      if (!session) forgetSession(id);
      else if (session.status !== 'active' && store.getSnapshot(id, 'end')) snapshots.forget(id);
    }
  };

  const closedError = (): Promise<never> => Promise.reject(new Error('pipeline is closed'));

  return {
    store,
    config,
    logger,
    paths,
    userHome: ctx.userHome,
    timing: ctx.timing,
    now,
    importOnce() {
      if (closed) return closedError();
      if (queuedImport) return queuedImport;
      const run = importChain.then(() => {
        queuedImport = null;
        return importer.importOnce();
      });
      queuedImport = run;
      importChain = run.catch(() => undefined);
      return run;
    },
    analyzePending() {
      if (closed) return closedError();
      return analysisLane.run(() => analyzer.analyzePending());
    },
    async analyzeSession(sessionId) {
      if (closed) return closedError();
      scheduler.cancel(sessionId);
      await analysisLane.run(() => analyzer.analyzeOne(sessionId));
    },
    sweep() {
      if (closed) return closedError();
      return analysisLane.run(async () => {
        await sweep(ctx, analyzer, snapshots, {
          onStatusChanged: (id) => scheduler.schedule(id),
          onRetention: prune,
        });
        try {
          prune();
        } catch (err) {
          logger.error('pruning session state failed', { error: describeError(err) });
        }
      });
    },
    failedTotal: () => importer.failedTotal,
    requestAnalysis(sessionId) {
      if (closed) return;
      try {
        store.markForAnalysis(sessionId);
      } catch (err) {
        logger.warn('marking session for analysis failed', { error: describeError(err) });
      }
      scheduler.schedule(sessionId);
    },
    forgetSession,
    async close() {
      if (closed) return;
      closed = true;
      scheduler.close();
      await importChain;
      await analysisLane.idle();
      try {
        store.close();
      } finally {
        ownedLogger?.close();
      }
    },
  };
}

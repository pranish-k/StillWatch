import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CLAUDE_HOOK_EVENTS, MIN_CLAUDE_CODE_VERSION } from '@stillwatch/adapter-claude';
import {
  createDefaultConfig,
  stillwatchPaths,
  type HookInstallStatus,
  type StillwatchConfig,
} from '@stillwatch/schema';
import { parse } from '../args';
import { detectClaude, errorMessage, isNpxCache, openStoreIfExists, stillwatchHome } from '../common';
import { exists } from '../fsutil';
import { formatAgo, formatBytes, formatCount, plural, type Ctx } from '../output';
import { VERSION } from '../version';

export type StatusJson = {
  version: string;
  stillwatchHome: string;
  configExists: boolean;
  hooks: HookInstallStatus;
  collector: { running: boolean; pid: number | null; port: number | null; url: string | null };
  spool: { pending: number; oldestAt: number | null };
  db: { path: string; exists: boolean; sizeBytes: number; sessions: number; events: number };
  lastEventAt: number | null;
  retentionDays: number | null;
  warnings: string[];
  ok: boolean;
};

async function spoolBacklog(dir: string): Promise<{ pending: number; oldestAt: number | null }> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { pending: 0, oldestAt: null };
  }
  let oldestAt: number | null = null;
  let pending = 0;
  for (const name of names) {
    try {
      const info = await stat(join(dir, name));
      if (!info.isFile()) continue;
      pending++;
      if (oldestAt === null || info.mtimeMs < oldestAt) oldestAt = info.mtimeMs;
    } catch {
      // Imported while we looked.
    }
  }
  return { pending, oldestAt };
}

export async function gatherStatus(ctx: Ctx): Promise<StatusJson> {
  const { deps } = ctx;
  const home = stillwatchHome(ctx);
  const paths = stillwatchPaths(home);
  const warnings: string[] = [];

  let config: StillwatchConfig | null = null;
  try {
    config = await deps.collector.readConfig(home);
  } catch (error) {
    warnings.push(`Config file is unreadable: ${errorMessage(error)}`);
  }
  const claudeVersion = await detectClaude(ctx);
  const hooks = await deps.installer.checkHookInstall(config ?? createDefaultConfig(deps.now()), {
    claudeVersion,
  });

  let collector: StatusJson['collector'] = { running: false, pid: null, port: null, url: null };
  try {
    const st = await deps.collector.collectorStatus(home);
    const port = st.port ?? (st.running ? (config?.port ?? null) : null);
    collector = { ...st, port, url: port !== null ? `http://127.0.0.1:${port}` : null };
  } catch (error) {
    warnings.push(`Could not check the collector: ${errorMessage(error)}`);
  }

  const spool = await spoolBacklog(paths.spoolNew);
  const db: StatusJson['db'] = { path: paths.db, exists: false, sizeBytes: 0, sessions: 0, events: 0 };
  let lastEventAt: number | null = null;
  try {
    const store = await openStoreIfExists(ctx, home, true);
    if (store !== null) {
      try {
        db.exists = true;
        Object.assign(db, store.counts());
        lastEventAt = store.lastEventAt();
      } finally {
        store.close();
      }
    }
  } catch (error) {
    warnings.push(`Could not read the database: ${errorMessage(error)}`);
  }

  const record = config?.install ?? null;
  if (record === null) {
    warnings.push("Stillwatch hooks are not installed. Run 'stillwatch install'.");
  } else {
    if (!hooks.installed) {
      warnings.push(
        `No Stillwatch hooks found in ${ctx.path(record.settingsPath)}. Run 'stillwatch install' again.`,
      );
    } else if (hooks.missing.length > 0) {
      warnings.push(
        `${plural(hooks.missing.length, 'hook event')} missing (${hooks.missing.join(', ')}). Run 'stillwatch install' again.`,
      );
    }
    if (!hooks.hookScriptOk) {
      warnings.push(`The hook script ${ctx.path(record.hookScript)} is missing or not Stillwatch's. Run 'stillwatch install' again.`);
    }
    if (!(await exists(record.cliPath)) || !(await exists(record.nodePath))) {
      warnings.push(
        "The Node or CLI path recorded at install no longer exists, so the hook cannot start the collector. Run 'stillwatch install' again.",
      );
    } else if (isNpxCache(record.cliPath)) {
      warnings.push('Installed from the npx cache, which npm may clean up. Install with: npm install -g stillwatch');
    }
  }
  if (hooks.claudeVersion === null) {
    warnings.push('Claude Code was not found on PATH.');
  } else if (hooks.compatible === false) {
    warnings.push(
      `Claude Code ${hooks.claudeVersion} is older than ${MIN_CLAUDE_CODE_VERSION}; hooks will not run. Update Claude Code.`,
    );
  }
  if (!collector.running && record !== null) {
    warnings.push(
      spool.pending > 0
        ? `The collector is not running and ${plural(spool.pending, 'event')} wait in the spool. Run 'stillwatch start'.`
        : "The collector is not running. It starts with the next session, or run 'stillwatch start'.",
    );
  }

  return {
    version: VERSION,
    stillwatchHome: home,
    configExists: config !== null,
    hooks,
    collector,
    spool,
    db,
    lastEventAt,
    retentionDays: config?.retentionDays ?? null,
    warnings,
    ok: warnings.length === 0,
  };
}

export async function statusCommand(ctx: Ctx, args: string[]): Promise<number> {
  const { values } = parse('status', args, { json: { type: 'boolean' } });
  const status = await gatherStatus(ctx);
  if (values.json === true) {
    ctx.out(JSON.stringify(status, null, 2));
    return 0;
  }
  const { s, deps } = ctx;
  const now = deps.now();
  const mark = (ok: boolean | null): string =>
    ok === true ? s.green('ok  ') : ok === false ? s.red('!!  ') : s.yellow('--  ');
  const lines: [boolean | null, string, string][] = [];
  const h = status.hooks;
  const total = CLAUDE_HOOK_EVENTS.length;
  lines.push([
    h.installed && h.missing.length === 0,
    'Hooks',
    h.settingsPath === null
      ? 'not installed'
      : `${h.scope ?? '?'} scope, ${h.events.length}/${total} events in ${ctx.path(h.settingsPath)}`,
  ]);
  if (h.settingsPath !== null) {
    lines.push([h.hookScriptOk, 'Hook script', h.hookScriptOk ? 'ok' : 'missing or changed']);
  }
  lines.push([
    h.compatible,
    'Claude Code',
    h.claudeVersion === null
      ? 'not found on PATH'
      : `${h.claudeVersion} (needs ${MIN_CLAUDE_CODE_VERSION} or newer)`,
  ]);
  const c = status.collector;
  lines.push([
    c.running,
    'Collector',
    c.running ? `running, pid ${c.pid ?? '?'}${c.url !== null ? `, ${c.url}` : ''}` : 'not running',
  ]);
  lines.push([
    status.spool.pending === 0 || c.running,
    'Spool',
    status.spool.pending === 0
      ? 'empty'
      : `${plural(status.spool.pending, 'event')} waiting${status.spool.oldestAt !== null ? `, oldest ${formatAgo(status.spool.oldestAt, now)}` : ''}`,
  ]);
  lines.push([
    status.db.exists ? true : null,
    'Database',
    status.db.exists
      ? `${plural(status.db.sessions, 'session')}, ${plural(status.db.events, 'event')}, ${formatBytes(status.db.sizeBytes)}`
      : 'no data yet',
  ]);
  lines.push([
    null,
    'Last event',
    status.lastEventAt === null ? 'none yet' : formatAgo(status.lastEventAt, now),
  ]);

  ctx.out(`${s.bold(`Stillwatch ${status.version}`)}  ${s.dim(ctx.path(status.stillwatchHome))}`);
  for (const [ok, label, value] of lines) {
    const prefix = label === 'Last event' ? '    ' : mark(ok);
    ctx.out(`  ${prefix}${label.padEnd(12)} ${value}`);
  }
  if (status.warnings.length > 0) {
    ctx.out('');
    ctx.out(s.bold('Next steps'));
    for (const warning of status.warnings) ctx.out(`  - ${warning}`);
  } else if (status.db.events === 0) {
    ctx.out('');
    ctx.out('Everything is ready. Start a Claude Code session to record it.');
  } else {
    ctx.out('');
    ctx.out(`All good. ${formatCount(status.db.sessions)} sessions recorded; run 'stillwatch open' to review.`);
  }
  return 0;
}

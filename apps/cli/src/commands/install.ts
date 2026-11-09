import { readdir, rm, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CLAUDE_HOOK_EVENTS, MIN_CLAUDE_CODE_VERSION } from '@stillwatch/adapter-claude';
import type { SettingsLocation } from '@stillwatch/installer';
import {
  baseName,
  createDefaultConfig,
  isWithin,
  pathKey,
  stillwatchPaths,
  type HookScope,
} from '@stillwatch/schema';
import { CliError, UsageError, parse } from '../args';
import {
  confirm,
  createdKeysOf,
  detectClaude,
  errorMessage,
  isNpxCache,
  readConfigOrFail,
  stillwatchHome,
  type StoredInstallRecord,
} from '../common';
import { unifiedDiff } from '../diff';
import { startErrorText } from './collector';
import { writeFileAtomic } from '../fsutil';
import { plural, type Ctx } from '../output';
import { VERSION } from '../version';

const SCOPES: readonly HookScope[] = ['user', 'project', 'local'];

function parseScope(command: string, value: string | undefined): HookScope | null {
  if (value === undefined) return null;
  const scope = SCOPES.find((s) => s === value);
  if (!scope) throw new UsageError(`--scope must be one of: ${SCOPES.join(', ')}`, command);
  return scope;
}

function settingsLocation(
  ctx: Ctx,
  command: string,
  scope: HookScope | null,
  projectDir: string | undefined,
): SettingsLocation {
  if (projectDir !== undefined && (scope === null || scope === 'user')) {
    throw new UsageError('--project-dir only applies to --scope project or local', command);
  }
  const configDir = ctx.deps.env.CLAUDE_CONFIG_DIR;
  return {
    home: ctx.deps.home,
    projectDir: resolve(ctx.deps.cwd, projectDir ?? '.'),
    claudeConfigDir:
      configDir !== undefined && configDir !== '' ? resolve(ctx.deps.cwd, configDir) : null,
  };
}

function isSettingsParseError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'SettingsParseError';
}

const OPTIONS_INSTALL = {
  scope: { type: 'string' },
  'project-dir': { type: 'string' },
  'dry-run': { type: 'boolean' },
  force: { type: 'boolean' },
  'no-start': { type: 'boolean' },
} as const;

export async function installCommand(ctx: Ctx, args: string[]): Promise<number> {
  const { values } = parse('install', args, OPTIONS_INSTALL);
  const { deps, s } = ctx;
  const scopeOption = parseScope('install', values.scope);
  const scope = scopeOption ?? 'user';
  const location = settingsLocation(ctx, 'install', scopeOption, values['project-dir']);
  const settingsPath = deps.installer.settingsPathFor(scope, location);
  const home = stillwatchHome(ctx);
  const paths = stillwatchPaths(home);
  const now = deps.now();

  const claudeVersion = await detectClaude(ctx);
  if (claudeVersion === null) {
    ctx.warn(
      `Claude Code was not found on PATH, so its version was not checked. Stillwatch needs Claude Code ${MIN_CLAUDE_CODE_VERSION} or newer.`,
    );
  } else {
    const check = await deps.installer.checkHookInstall(createDefaultConfig(now), {
      claudeVersion,
    });
    if (check.compatible === false) {
      const message = `Claude Code ${claudeVersion} is older than ${MIN_CLAUDE_CODE_VERSION}, the first version that runs hooks without a shell.`;
      if (values.force !== true) {
        throw new CliError(`${message} Update Claude Code, or rerun with --force.`);
      }
      ctx.warn(`${message} Installing anyway (--force); hooks may not run.`);
    }
  }

  const before = await deps.installer.readSettingsFile(settingsPath);
  const plan = deps.installer.planHookEntries({
    hookScript: paths.hookScript,
    agent: 'claude-code',
    events: CLAUDE_HOOK_EVENTS,
  });
  let add;
  try {
    add = deps.installer.addHooksToSettings(before, plan);
  } catch (error) {
    if (!isSettingsParseError(error)) throw error;
    throw new CliError(
      `Cannot edit ${ctx.path(settingsPath)}: ${error.message} Nothing was changed. Fix the file and run install again.`,
    );
  }

  if (values['dry-run'] === true) {
    ctx.out(s.bold('Dry run: nothing was changed.'));
    ctx.out(
      `Settings file: ${ctx.path(settingsPath)} (${scope} scope${before === null ? ', would be created' : ''})`,
    );
    ctx.out(`Hook script:   ${ctx.path(paths.hookScript)}`);
    if (!add.changed) {
      ctx.out(`All ${plural(add.alreadyPresent.length, 'hook event')} are already installed.`);
      return 0;
    }
    ctx.out(
      `Would add ${plural(add.added.length, 'hook event')}${add.alreadyPresent.length > 0 ? `; ${add.alreadyPresent.length} already present` : ''}.`,
    );
    ctx.out('');
    ctx.out(s.dim(`--- ${ctx.path(settingsPath)}${before === null ? ' (new file)' : ''}`));
    ctx.out(s.dim(`+++ ${ctx.path(settingsPath)}`));
    for (const line of unifiedDiff(before ?? '', add.text)) {
      ctx.out(line.startsWith('+') ? s.green(line) : line.startsWith('-') ? s.red(line) : line);
    }
    return 0;
  }

  const existing = await readConfigOrFail(ctx, home);
  const prior = existing?.install ?? null;
  if (prior !== null && pathKey(prior.settingsPath) !== pathKey(settingsPath)) {
    throw new CliError(
      `Stillwatch is already installed in ${prior.scope} scope (${ctx.path(prior.settingsPath)}). Run 'stillwatch uninstall' first, then install again.`,
    );
  }

  await deps.collector.ensureDataDirs(home);
  const config = await deps.collector.loadOrCreateConfig(home, now);
  const hookScriptText = deps.collector.renderHookScript({
    stillwatchHome: home,
    nodePath: deps.execPath,
    cliPath: deps.cliPath,
  });
  await writeFileAtomic(paths.hookScript, hookScriptText, 0o700);
  if (isNpxCache(deps.cliPath)) {
    ctx.warn(
      'Stillwatch is running from the npx cache, which npm may clean up; the hook could then not start the collector. Install it with: npm install -g stillwatch',
    );
  }

  let backupPath: string | null = null;
  if (add.changed) {
    backupPath = await deps.installer.backupSettingsFile(settingsPath, paths.backups, now);
    await deps.installer.writeSettingsFile(settingsPath, add.text);
  }

  const priorCreated = prior !== null ? await createdKeysOf(prior) : [];
  const record: StoredInstallRecord = {
    installedAt: now,
    scope,
    settingsPath,
    settingsExisted: prior !== null ? prior.settingsExisted : before !== null,
    backupPath: prior !== null ? prior.backupPath : backupPath,
    events: plan.map((entry) => entry.event),
    hookScript: paths.hookScript,
    nodePath: deps.execPath,
    cliPath: deps.cliPath,
    claudeVersion,
    stillwatchVersion: VERSION,
    createdEventKeys: [...new Set([...priorCreated, ...add.createdEventKeys])],
  };
  await deps.collector.saveConfig(home, { ...config, install: record });

  ctx.out(s.bold(`Stillwatch hooks installed (${scope} scope).`));
  const rows: [string, string][] = [
    [
      'Settings',
      `${ctx.path(settingsPath)}: ${
        add.changed
          ? `added ${plural(add.added.length, 'hook event')}${add.alreadyPresent.length > 0 ? `, ${add.alreadyPresent.length} already present` : ''}`
          : 'already up to date, nothing changed'
      }`,
    ],
  ];
  if (backupPath !== null) rows.push(['Backup', ctx.path(backupPath)]);
  rows.push(['Hook script', ctx.path(paths.hookScript)]);
  rows.push(['Data', ctx.path(home)]);
  if (values['no-start'] === true) {
    rows.push(['Collector', 'not started (--no-start); it starts with the next session']);
  } else {
    rows.push(['Collector', await ensureCollectorRunning(ctx, home)]);
  }
  for (const [label, value] of rows) ctx.out(`  ${label.padEnd(12)} ${value}`);
  if (scope === 'project') {
    ctx.warn(
      `${ctx.path(settingsPath)} is usually committed, and the hook path is specific to this computer. Consider --scope local.`,
    );
  }
  ctx.out('');
  ctx.out(s.bold('Next steps'));
  ctx.out('  1. Start a new Claude Code session. Sessions already running may not load the hooks.');
  ctx.out(
    "  2. Run 'stillwatch open' to review sessions, or 'stillwatch status' to check capture.",
  );
  return 0;
}

async function ensureCollectorRunning(ctx: Ctx, home: string): Promise<string> {
  try {
    const status = await ctx.deps.collector.collectorStatus(home);
    if (status.running) return `already running (pid ${status.pid ?? '?'})`;
    const { pid } = await ctx.deps.collector.startCollector({
      stillwatchHome: home,
      nodePath: ctx.deps.execPath,
      cliPath: ctx.deps.cliPath,
    });
    return `started (pid ${pid})`;
  } catch (error) {
    // The hooks still record into the spool; the collector imports it once it runs.
    ctx.warn(
      `The collector did not start: ${error instanceof Error ? startErrorText(ctx, error) : errorMessage(error)}`,
    );
    return "not running; fix the problem above, then run 'stillwatch start'";
  }
}

const OPTIONS_UNINSTALL = {
  scope: { type: 'string' },
  'project-dir': { type: 'string' },
  purge: { type: 'boolean' },
  yes: { type: 'boolean' },
} as const;

/** Files and directories Stillwatch owns inside its home; --purge deletes only these. */
const OWNED_ENTRIES = [
  'config.json',
  'stillwatch.db',
  'stillwatch.db-wal',
  'stillwatch.db-shm',
  'stillwatch.db-journal',
  'spool',
  'bin',
  'backups',
  'run',
  'logs',
];

export async function uninstallCommand(ctx: Ctx, args: string[]): Promise<number> {
  const { values } = parse('uninstall', args, OPTIONS_UNINSTALL);
  const { deps, s } = ctx;
  const scopeOption = parseScope('uninstall', values.scope);
  const location = settingsLocation(ctx, 'uninstall', scopeOption, values['project-dir']);
  const home = stillwatchHome(ctx);
  const paths = stillwatchPaths(home);
  const purge = values.purge === true;

  if (purge) {
    if (pathKey(home) === '/' || isWithin(deps.home, home)) {
      throw new CliError(`Refusing to purge ${home}: it is not a Stillwatch data directory.`);
    }
    const ok = await confirm(
      ctx,
      `Delete all Stillwatch data in ${ctx.path(home)}, including every recorded session?`,
      values.yes === true,
      'purge data',
    );
    if (!ok) {
      ctx.out('Cancelled. Nothing was changed.');
      return 1;
    }
  }

  const config = await readConfigOrFail(ctx, home);
  const record = config?.install ?? null;
  const target =
    scopeOption !== null
      ? deps.installer.settingsPathFor(scopeOption, location)
      : (record?.settingsPath ?? deps.installer.settingsPathFor('user', location));
  const matchesRecord = record !== null && pathKey(record.settingsPath) === pathKey(target);
  const hookScript = matchesRecord ? record.hookScript : paths.hookScript;
  const created = matchesRecord ? await createdKeysOf(record) : [];

  const text = await deps.installer.readSettingsFile(target);
  let summary = 'no Stillwatch hooks found';
  if (text !== null) {
    let result;
    try {
      result = deps.installer.removeHooksFromSettings(text, hookScript, created);
    } catch (error) {
      if (!isSettingsParseError(error)) throw error;
      throw new CliError(
        `Cannot edit ${ctx.path(target)}: ${error.message} Nothing was changed. Fix the file and run uninstall again.`,
      );
    }
    if (result.changed) {
      if (result.emptyAfter && matchesRecord && !record.settingsExisted) {
        await rm(target, { force: true });
        summary = `removed ${plural(result.removed.length, 'hook event')}; deleted the file Stillwatch created`;
      } else {
        await deps.installer.backupSettingsFile(target, paths.backups, deps.now());
        await deps.installer.writeSettingsFile(target, result.text);
        summary = `removed ${plural(result.removed.length, 'hook event')}`;
      }
    }
  } else {
    summary = 'file does not exist';
  }

  let collectorLine: string;
  try {
    collectorLine = (await deps.collector.stopCollector(home)) ? 'stopped' : 'was not running';
  } catch (error) {
    ctx.warn(`Could not stop the collector: ${errorMessage(error)}`);
    collectorLine = "still running; run 'stillwatch stop'";
  }

  if (matchesRecord && config !== null && !purge) {
    await deps.collector.saveConfig(home, { ...config, install: null });
  }

  ctx.out(s.bold('Stillwatch hooks removed.'));
  ctx.out(`  ${'Settings'.padEnd(12)} ${ctx.path(target)}: ${summary}`);
  ctx.out(`  ${'Collector'.padEnd(12)} ${collectorLine}`);
  if (record !== null && !matchesRecord) {
    ctx.warn(
      `Stillwatch is still recorded as installed in ${ctx.path(record.settingsPath)}. Run 'stillwatch uninstall' without --scope to remove it.`,
    );
  }

  if (purge) {
    const left = await purgeHome(home);
    ctx.out(`  ${'Data'.padEnd(12)} deleted ${ctx.path(home)}`);
    if (left.length > 0) {
      ctx.warn(
        `Left ${plural(left.length, 'file')} Stillwatch did not create in ${ctx.path(home)}: ${left.join(', ')}`,
      );
    }
  } else {
    ctx.out(
      `  ${'Data'.padEnd(12)} kept in ${ctx.path(home)} (delete with 'stillwatch uninstall --purge')`,
    );
  }
  return 0;
}

/** Deletes only Stillwatch's own entries, then the directory if it is empty. Returns leftovers. */
async function purgeHome(home: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(home);
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (OWNED_ENTRIES.includes(entry) || /^\.config\.json\..*\.tmp$/.test(entry)) {
      await rm(join(home, entry), { recursive: true, force: true });
    }
  }
  const left = await readdir(home);
  if (left.length === 0) await rmdir(home);
  return left.map((name) => baseName(name));
}

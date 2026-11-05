/**
 * @stillwatch/installer
 *
 * Reads, edits, and checks Claude Code settings files so Stillwatch can add
 * and remove exactly its own hook entries (spec: "Removal leaves user hook
 * settings as they were").
 *
 * Rules:
 * - Settings files are user data. Parse them; never rewrite them with string
 *   tricks. Refuse (throw SettingsParseError) on invalid JSON instead of
 *   overwriting it.
 * - Stillwatch's entries are recognized only by their handler: `command` is
 *   "/bin/sh" and `args[0]` is Stillwatch's hook script path. Never add
 *   unknown fields to hook entries (Claude Code validates settings).
 * - Each Stillwatch handler goes in its own matcher group without a matcher,
 *   appended after the user's groups. Other groups and keys are untouched and
 *   keep their order. Output is 2-space JSON with a trailing newline.
 * - Removing the last Stillwatch entry of an event removes the event key only
 *   if Stillwatch's install created it; an empty `hooks` object is removed only
 *   if Stillwatch created it.
 * - Writes are atomic (temp file in the same directory, fsync, rename) and keep
 *   the original file mode (0600 for new files).
 * - User scope honors CLAUDE_CONFIG_DIR, like Claude Code does.
 *
 * Public API contract. Signatures are fixed; implementations replace the stubs.
 *
 * Implementation note: when `addHooksToSettings` creates the top-level `hooks`
 * object, `createdEventKeys` also holds `CREATED_HOOKS_OBJECT`, so that
 * `removeHooksFromSettings` can drop the object again (and only then).
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  CLAUDE_HOOK_EVENTS,
  MIN_CLAUDE_CODE_VERSION,
  type HookEventSpec,
} from '@stillwatch/adapter-claude';
import {
  isRecord,
  stillwatchPaths,
  type HookInstallStatus,
  type HookScope,
  type StillwatchConfig,
} from '@stillwatch/schema';
import { compareVersionStrings, parseVersionOutput } from './version';

export class SettingsParseError extends Error {
  override name = 'SettingsParseError';
}

/**
 * Marker kept in `AddResult.createdEventKeys` when the install created the
 * top-level `hooks` object. It can never collide with an event name.
 */
export const CREATED_HOOKS_OBJECT = '(hooks)';

export type SettingsLocation = {
  /** The user's home directory. */
  home: string;
  /** Project root for `project` and `local` scope. */
  projectDir: string | null;
  /** Value of CLAUDE_CONFIG_DIR, if set. */
  claudeConfigDir: string | null;
};

/**
 * user: `$CLAUDE_CONFIG_DIR/settings.json` or `~/.claude/settings.json`.
 * project: `<projectDir>/.claude/settings.json`.
 * local: `<projectDir>/.claude/settings.local.json`.
 */
export function settingsPathFor(scope: HookScope, location: SettingsLocation): string {
  switch (scope) {
    case 'user': {
      const dir =
        location.claudeConfigDir !== null && location.claudeConfigDir !== ''
          ? location.claudeConfigDir
          : join(location.home, '.claude');
      return join(dir, 'settings.json');
    }
    case 'project':
      return join(requireProjectDir(scope, location), '.claude', 'settings.json');
    case 'local':
      return join(requireProjectDir(scope, location), '.claude', 'settings.local.json');
  }
}

function requireProjectDir(scope: HookScope, location: SettingsLocation): string {
  if (location.projectDir === null || location.projectDir === '') {
    throw new Error(`The ${scope} scope needs a project directory.`);
  }
  return location.projectDir;
}

/** One hook handler Stillwatch installs. */
export type HookEntryPlan = {
  event: string;
  command: '/bin/sh';
  /** [hookScript, agent, event] plus "--ensure-collector" when the spec asks for it. */
  args: string[];
  async: boolean;
  timeoutSec: number | null;
};

export function planHookEntries(options: {
  hookScript: string;
  agent: 'claude-code';
  events: readonly HookEventSpec[];
}): HookEntryPlan[] {
  return options.events.map((spec) => ({
    event: spec.event,
    command: '/bin/sh',
    args: [
      options.hookScript,
      options.agent,
      spec.event,
      ...(spec.ensureCollector ? ['--ensure-collector'] : []),
    ],
    async: spec.mode === 'async',
    // SessionEnd never gets a timeout: any value raises the shared SessionEnd budget.
    timeoutSec: spec.event === 'SessionEnd' ? null : spec.timeoutSec,
  }));
}

export type AddResult = {
  /** New file text. Equal to the input when nothing changed. */
  text: string;
  changed: boolean;
  added: string[];
  alreadyPresent: string[];
  /** Events whose key Stillwatch created (not present before). */
  createdEventKeys: string[];
};

type Handler = Record<string, unknown>;

function handlerFor(entry: HookEntryPlan): Handler {
  const handler: Handler = { type: 'command', command: entry.command, args: [...entry.args] };
  if (entry.async) handler.async = true;
  if (entry.timeoutSec !== null) handler.timeout = entry.timeoutSec;
  return handler;
}

function isStillwatchHandler(value: unknown, hookScript: string): boolean {
  return (
    isRecord(value) &&
    value.command === '/bin/sh' &&
    Array.isArray(value.args) &&
    value.args[0] === hookScript
  );
}

function parseSettings(text: string | null): Record<string, unknown> {
  if (text === null) return {};
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  if (body.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SettingsParseError(`The settings file is not valid JSON (${reason}).`);
  }
  if (!isRecord(parsed)) {
    throw new SettingsParseError('The settings file does not hold a JSON object.');
  }
  return parsed;
}

function hooksObject(root: Record<string, unknown>): Record<string, unknown> | undefined {
  const hooks = root.hooks;
  if (hooks === undefined) return undefined;
  if (!isRecord(hooks)) {
    throw new SettingsParseError('The "hooks" setting is not a JSON object.');
  }
  return hooks;
}

function serialize(root: Record<string, unknown>): string {
  return `${JSON.stringify(root, null, 2)}\n`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

/** Adds the planned entries to settings text (`null` = file does not exist). Idempotent. Pure. */
export function addHooksToSettings(text: string | null, plan: HookEntryPlan[]): AddResult {
  const root = parseSettings(text);
  const existingHooks = hooksObject(root);
  const hooks = existingHooks ?? {};
  const added: string[] = [];
  const alreadyPresent: string[] = [];
  const createdEventKeys: string[] = [];

  for (const entry of plan) {
    const desired = handlerFor(entry);
    const hookScript = entry.args[0] ?? '';
    const groups = hooks[entry.event];
    if (groups === undefined) {
      hooks[entry.event] = [{ hooks: [desired] }];
      added.push(entry.event);
      createdEventKeys.push(entry.event);
      continue;
    }
    if (!Array.isArray(groups)) {
      throw new SettingsParseError(`The "hooks.${entry.event}" setting is not a JSON array.`);
    }
    const location = findHandler(groups, hookScript);
    if (location === null) {
      groups.push({ hooks: [desired] });
      added.push(entry.event);
    } else if (deepEqual(location.handlers[location.index], desired)) {
      alreadyPresent.push(entry.event);
    } else {
      // An older Stillwatch handler: update it in place.
      location.handlers[location.index] = desired;
      added.push(entry.event);
    }
  }

  if (added.length === 0) {
    return { text: text ?? '', changed: false, added, alreadyPresent, createdEventKeys };
  }
  if (existingHooks === undefined) {
    root.hooks = hooks;
    createdEventKeys.push(CREATED_HOOKS_OBJECT);
  }
  return { text: serialize(root), changed: true, added, alreadyPresent, createdEventKeys };
}

function findHandler(
  groups: unknown[],
  hookScript: string,
): { handlers: unknown[]; index: number } | null {
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
    const handlers: unknown[] = group.hooks;
    const index = handlers.findIndex((h) => isStillwatchHandler(h, hookScript));
    if (index !== -1) return { handlers, index };
  }
  return null;
}

export type RemoveResult = {
  text: string;
  changed: boolean;
  removed: string[];
  /** True when the result holds nothing but `{}`. */
  emptyAfter: boolean;
};

/**
 * Removes every handler whose `args[0]` is `hookScript`. Empty matcher groups
 * left behind are removed; event keys listed in `createdEventKeys` are removed
 * when empty. Pure.
 */
export function removeHooksFromSettings(
  text: string,
  hookScript: string,
  createdEventKeys: readonly string[],
): RemoveResult {
  const root = parseSettings(text);
  const hooks = root.hooks;
  const removed: string[] = [];
  if (isRecord(hooks)) {
    const created = new Set(createdEventKeys);
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      const kept: unknown[] = [];
      let removedHere = false;
      for (const group of groups) {
        if (isRecord(group) && Array.isArray(group.hooks)) {
          const handlers: unknown[] = group.hooks;
          const remaining = handlers.filter((h) => !isStillwatchHandler(h, hookScript));
          if (remaining.length !== handlers.length) {
            removedHere = true;
            if (remaining.length > 0) kept.push({ ...group, hooks: remaining });
            continue;
          }
        }
        kept.push(group);
      }
      if (!removedHere) continue;
      removed.push(event);
      if (kept.length === 0 && created.has(event)) Reflect.deleteProperty(hooks, event);
      else hooks[event] = kept;
    }
    if (
      removed.length > 0 &&
      Object.keys(hooks).length === 0 &&
      created.has(CREATED_HOOKS_OBJECT)
    ) {
      delete root.hooks;
    }
  }
  const emptyAfter = Object.keys(root).length === 0;
  if (removed.length === 0) return { text, changed: false, removed, emptyAfter };
  return { text: serialize(root), changed: true, removed, emptyAfter };
}

/** Hook events in the settings text whose handler runs `hookScript`. Pure. */
export function installedEvents(text: string | null, hookScript: string): string[] {
  const root = parseSettings(text);
  const hooks = root.hooks;
  if (!isRecord(hooks)) return [];
  const events: string[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (Array.isArray(groups) && findHandler(groups, hookScript) !== null) events.push(event);
  }
  return events;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

/** Reads a settings file, or null when it does not exist. */
export async function readSettingsFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    throw error;
  }
}

/** Atomic write (temp file, fsync, rename), keeping the existing mode or using 0600. Creates the parent directory (0700) if needed. */
export async function writeSettingsFile(path: string, text: string): Promise<void> {
  // Write through a symlink (dotfile setups) instead of replacing the link.
  let target = path;
  try {
    target = await realpath(path);
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error;
  }
  let mode = 0o600;
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error(`${target} is not a regular file.`);
    mode = info.mode & 0o777;
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error;
  }
  const dir = dirname(target);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.${basename(target)}.stillwatch-${randomBytes(6).toString('hex')}.tmp`);
  const handle = await open(tmp, 'wx', mode);
  try {
    try {
      await handle.writeFile(text, 'utf8');
      await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  await syncDirectory(dir);
}

async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is best effort; not every filesystem supports it.
  }
}

/** Copies the settings file into `backupsDir` (mode 0600) and returns the copy's path, or null when there is no file. */
export async function backupSettingsFile(
  path: string,
  backupsDir: string,
  now: number,
): Promise<string | null> {
  let data: Buffer;
  try {
    data = await readFile(path);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    throw error;
  }
  await mkdir(backupsDir, { recursive: true, mode: 0o700 });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const base = `${basename(path)}.${stamp}`;
  for (let attempt = 0; ; attempt++) {
    const name = attempt === 0 ? `${base}.bak` : `${base}.${attempt}.bak`;
    const backupPath = join(backupsDir, name);
    let handle;
    try {
      handle = await open(backupPath, 'wx', 0o600);
    } catch (error) {
      if (isErrno(error, 'EEXIST')) continue;
      throw error;
    }
    try {
      await handle.writeFile(data);
      await handle.chmod(0o600);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return backupPath;
  }
}

/** Runs `claude --version` (execFile, no shell, short timeout) and parses it. Null when unavailable. */
export function detectClaudeVersion(options?: {
  claudeBinary?: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const binary = options?.claudeBinary ?? 'claude';
  const timeout = options?.timeoutMs ?? 3000;
  return new Promise((resolve) => {
    execFile(
      binary,
      ['--version'],
      { timeout, encoding: 'utf8', maxBuffer: 64 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(parseVersionOutput(stdout));
      },
    );
  });
}

/**
 * Checks the install recorded in `config` against the settings file and the
 * hook script on disk. Never throws; problems become `missing` events,
 * `hookScriptOk: false`, or `installed: false`.
 */
export async function checkHookInstall(
  config: StillwatchConfig,
  options?: { claudeVersion?: string | null },
): Promise<HookInstallStatus> {
  const claudeVersion =
    options?.claudeVersion !== undefined ? options.claudeVersion : await detectClaudeVersion();
  const compatible =
    claudeVersion === null
      ? null
      : compareVersionStrings(claudeVersion, MIN_CLAUDE_CODE_VERSION) >= 0;
  const expected = CLAUDE_HOOK_EVENTS.map((spec) => spec.event);
  const record = config.install;
  if (record === null) {
    return {
      installed: false,
      scope: null,
      settingsPath: null,
      events: [],
      missing: expected,
      hookScriptOk: false,
      claudeVersion,
      compatible,
    };
  }
  let found = new Set<string>();
  try {
    found = new Set(
      installedEvents(await readSettingsFile(record.settingsPath), record.hookScript),
    );
  } catch {
    found = new Set();
  }
  const events = expected.filter((event) => found.has(event));
  const missing = expected.filter((event) => !found.has(event));
  return {
    installed: events.length > 0,
    scope: record.scope,
    settingsPath: record.settingsPath,
    events,
    missing,
    hookScriptOk: await hookScriptLooksRight(record.hookScript),
    claudeVersion,
    compatible,
  };
}

/** The hook script is a regular file that writes into this Stillwatch home's spool. */
async function hookScriptLooksRight(hookScript: string): Promise<boolean> {
  try {
    const info = await lstat(hookScript);
    if (!info.isFile()) return false;
    const content = await readFile(hookScript, 'utf8');
    const home = dirname(dirname(hookScript));
    const paths = stillwatchPaths(home);
    return (
      content.includes(paths.spoolNew) ||
      content.includes(paths.spool) ||
      (content.includes(home) && content.includes('spool/'))
    );
  } catch {
    return false;
  }
}

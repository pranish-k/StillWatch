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
 */
import type { HookEventSpec } from '@stillwatch/adapter-claude';
import type { HookInstallStatus, HookScope, StillwatchConfig } from '@stillwatch/schema';

export class SettingsParseError extends Error {
  override name = 'SettingsParseError';
}

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
export function settingsPathFor(_scope: HookScope, _location: SettingsLocation): string {
  throw new Error('not implemented: settingsPathFor');
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

export function planHookEntries(_options: {
  hookScript: string;
  agent: 'claude-code';
  events: readonly HookEventSpec[];
}): HookEntryPlan[] {
  throw new Error('not implemented: planHookEntries');
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

/** Adds the planned entries to settings text (`null` = file does not exist). Idempotent. Pure. */
export function addHooksToSettings(_text: string | null, _plan: HookEntryPlan[]): AddResult {
  throw new Error('not implemented: addHooksToSettings');
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
  _text: string,
  _hookScript: string,
  _createdEventKeys: readonly string[],
): RemoveResult {
  throw new Error('not implemented: removeHooksFromSettings');
}

/** Hook events in the settings text whose handler runs `hookScript`. Pure. */
export function installedEvents(_text: string | null, _hookScript: string): string[] {
  throw new Error('not implemented: installedEvents');
}

/** Reads a settings file, or null when it does not exist. */
export function readSettingsFile(_path: string): Promise<string | null> {
  return Promise.reject(new Error('not implemented: readSettingsFile'));
}

/** Atomic write (temp file, fsync, rename), keeping the existing mode or using 0600. Creates the parent directory (0700) if needed. */
export function writeSettingsFile(_path: string, _text: string): Promise<void> {
  return Promise.reject(new Error('not implemented: writeSettingsFile'));
}

/** Copies the settings file into `backupsDir` (mode 0600) and returns the copy's path, or null when there is no file. */
export function backupSettingsFile(
  _path: string,
  _backupsDir: string,
  _now: number,
): Promise<string | null> {
  return Promise.reject(new Error('not implemented: backupSettingsFile'));
}

/** Runs `claude --version` (execFile, no shell, short timeout) and parses it. Null when unavailable. */
export function detectClaudeVersion(_options?: {
  claudeBinary?: string;
  timeoutMs?: number;
}): Promise<string | null> {
  return Promise.reject(new Error('not implemented: detectClaudeVersion'));
}

/**
 * Checks the install recorded in `config` against the settings file and the
 * hook script on disk. Never throws; problems become `missing` events,
 * `hookScriptOk: false`, or `installed: false`.
 */
export function checkHookInstall(
  _config: StillwatchConfig,
  _options?: { claudeVersion?: string | null },
): Promise<HookInstallStatus> {
  return Promise.reject(new Error('not implemented: checkHookInstall'));
}

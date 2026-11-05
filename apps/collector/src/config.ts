import type { StillwatchConfig } from '@stillwatch/schema';

/** `$STILLWATCH_HOME` if set, else `~/.stillwatch`. */
export function resolveStillwatchHome(_env?: Record<string, string | undefined>): string {
  throw new Error('not implemented: resolveStillwatchHome');
}

/** Creates the data directory tree with mode 0700 (idempotent; tightens loose modes). */
export function ensureDataDirs(_stillwatchHome: string): Promise<void> {
  return Promise.reject(new Error('not implemented: ensureDataDirs'));
}

/** Reads config.json, creating it (mode 0600) with fresh secrets when missing. */
export function loadOrCreateConfig(
  _stillwatchHome: string,
  _now?: number,
): Promise<StillwatchConfig> {
  return Promise.reject(new Error('not implemented: loadOrCreateConfig'));
}

/** Reads config.json, or null when it does not exist. Throws on a corrupt file. */
export function readConfig(_stillwatchHome: string): Promise<StillwatchConfig | null> {
  return Promise.reject(new Error('not implemented: readConfig'));
}

/** Atomically writes config.json (temp file + rename, mode 0600). */
export function saveConfig(_stillwatchHome: string, _config: StillwatchConfig): Promise<void> {
  return Promise.reject(new Error('not implemented: saveConfig'));
}

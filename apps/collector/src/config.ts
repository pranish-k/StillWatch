/**
 * The Stillwatch data directory and its config.json.
 *
 * config.json holds secrets (auth secret, fingerprint key), so it is always
 * written atomically with mode 0600 inside the 0700 data directory. Reading is
 * defensive: a field with a bad value falls back to its default, and
 * `loadOrCreateConfig` writes the repaired file back. A file that is not JSON
 * is never overwritten; reading it throws so a person can look at it.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createDefaultConfig,
  getBoolean,
  getNumber,
  getString,
  getStringArray,
  isRecord,
  stillwatchPaths,
  STILLWATCH_HOME_ENV,
  type HookScope,
  type InstallRecord,
  type StillwatchConfig,
} from '@stillwatch/schema';
import { ensurePrivateDir, hasErrorCode, writeFileAtomic, writeFileExclusive } from './fs-safe';

/** `$STILLWATCH_HOME` if set, else `~/.stillwatch`. */
export function resolveStillwatchHome(
  env: Record<string, string | undefined> = process.env,
): string {
  const fromEnv = env[STILLWATCH_HOME_ENV];
  if (fromEnv !== undefined && fromEnv.trim() !== '') return resolve(fromEnv);
  return join(homedir(), '.stillwatch');
}

/** Creates the data directory tree with mode 0700 (idempotent; tightens loose modes). */
export async function ensureDataDirs(stillwatchHome: string): Promise<void> {
  const paths = stillwatchPaths(stillwatchHome);
  for (const dir of [
    paths.home,
    paths.spool,
    paths.spoolTmp,
    paths.spoolNew,
    paths.bin,
    paths.backups,
    paths.run,
    paths.logs,
  ]) {
    await ensurePrivateDir(dir);
  }
}

/** Reads config.json, creating it (mode 0600) with fresh secrets when missing. */
export async function loadOrCreateConfig(
  stillwatchHome: string,
  now: number = Date.now(),
): Promise<StillwatchConfig> {
  const file = stillwatchPaths(stillwatchHome).config;
  const existing = await readConfigFile(file, now);
  if (existing) {
    if (existing.repaired) await saveConfig(stillwatchHome, existing.config);
    return existing.config;
  }
  await ensurePrivateDir(stillwatchPaths(stillwatchHome).home);
  const fresh = createDefaultConfig(now);
  if (await writeFileExclusive(file, serializeConfig(fresh))) return fresh;
  // Another process created it first: use theirs, so secrets stay stable.
  const raced = await readConfigFile(file, now);
  if (!raced) throw new Error('config.json disappeared while it was being created');
  return raced.config;
}

/** Reads config.json, or null when it does not exist. Throws on a corrupt file. */
export async function readConfig(stillwatchHome: string): Promise<StillwatchConfig | null> {
  const result = await readConfigFile(stillwatchPaths(stillwatchHome).config, Date.now());
  return result ? result.config : null;
}

/** Atomically writes config.json (temp file + rename, mode 0600). */
export async function saveConfig(stillwatchHome: string, config: StillwatchConfig): Promise<void> {
  const paths = stillwatchPaths(stillwatchHome);
  await ensurePrivateDir(paths.home);
  await writeFileAtomic(paths.config, serializeConfig(config));
}

function serializeConfig(config: StillwatchConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

type ParsedConfig = { config: StillwatchConfig; repaired: boolean };

async function readConfigFile(file: string, now: number): Promise<ParsedConfig | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (hasErrorCode(err, 'ENOENT')) return null;
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`config.json is not valid JSON: ${file}`);
  }
  if (!isRecord(raw)) throw new Error(`config.json is not a JSON object: ${file}`);
  return normalizeConfig(raw, now);
}

/** Secrets are 32 random bytes as base64url (43 characters); accept anything at least that strong. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

/**
 * Builds a valid config from parsed JSON, replacing invalid fields with
 * defaults (fresh secrets for invalid secrets). `repaired` tells whether
 * anything was replaced.
 */
function normalizeConfig(raw: Record<string, unknown>, now: number): ParsedConfig {
  const defaults = createDefaultConfig(now);
  let repaired = raw.v !== 1;

  const pick = <T>(value: T | null, valid: (v: T) => boolean, fallback: T): T => {
    if (value !== null && valid(value)) return value;
    repaired = true;
    return fallback;
  };

  const port = pick(
    getNumber(raw, 'port'),
    (v) => Number.isInteger(v) && v >= 1 && v <= 65_535,
    defaults.port,
  );
  const retentionDays = pick(
    getNumber(raw, 'retentionDays'),
    (v) => Number.isInteger(v) && v >= 1 && v <= 36_500,
    defaults.retentionDays,
  );
  const authSecret = pick(
    getString(raw, 'authSecret'),
    (v) => SECRET_PATTERN.test(v),
    defaults.authSecret,
  );
  const fingerprintKey = pick(
    getString(raw, 'fingerprintKey'),
    (v) => SECRET_PATTERN.test(v),
    defaults.fingerprintKey,
  );
  const createdAt = pick(getNumber(raw, 'createdAt'), (v) => v >= 0, defaults.createdAt);

  let install: InstallRecord | null = null;
  const rawInstall = raw.install;
  if (rawInstall !== null && rawInstall !== undefined) {
    install = isRecord(rawInstall) ? normalizeInstall(rawInstall) : null;
    if (install === null) repaired = true;
  } else if (rawInstall === undefined) {
    repaired = true;
  }

  return {
    config: { v: 1, port, retentionDays, authSecret, fingerprintKey, createdAt, install },
    repaired,
  };
}

const SCOPES: readonly HookScope[] = ['user', 'project', 'local'];

/**
 * Validates an install record. The two paths uninstall needs (settings file
 * and hook script) are required; other fields fall back to safe defaults
 * (`settingsExisted: true`, so uninstall never deletes a file it did not create).
 */
function normalizeInstall(raw: Record<string, unknown>): InstallRecord | null {
  const settingsPath = getString(raw, 'settingsPath');
  const hookScript = getString(raw, 'hookScript');
  if (settingsPath === null || settingsPath === '' || hookScript === null || hookScript === '') {
    return null;
  }
  const scopeValue = getString(raw, 'scope');
  const scope = SCOPES.find((s) => s === scopeValue) ?? 'user';
  return {
    installedAt: getNumber(raw, 'installedAt') ?? 0,
    scope,
    settingsPath,
    settingsExisted: getBoolean(raw, 'settingsExisted') ?? true,
    backupPath: getString(raw, 'backupPath'),
    events: getStringArray(raw, 'events'),
    hookScript,
    nodePath: getString(raw, 'nodePath') ?? '',
    cliPath: getString(raw, 'cliPath') ?? '',
    claudeVersion: getString(raw, 'claudeVersion'),
    stillwatchVersion: getString(raw, 'stillwatchVersion') ?? '',
  };
}

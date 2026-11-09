/**
 * Stillwatch's local configuration and data directory layout.
 *
 * Data lives in `$STILLWATCH_HOME`, default `~/.stillwatch` (mode 0700).
 * Files inside are mode 0600.
 */
import { DEFAULT_PORT, DEFAULT_RETENTION_DAYS } from './constants';
import { randomToken } from './ids';
import { joinPath } from './paths';

export type HookScope = 'user' | 'project' | 'local';

/** What `stillwatch install` did, so `uninstall` can undo exactly that. */
export type InstallRecord = {
  installedAt: number;
  scope: HookScope;
  /** Absolute path of the Claude Code settings file that holds Stillwatch's hooks. */
  settingsPath: string;
  /** Whether that file existed before install. If not, uninstall may remove it when nothing else is left. */
  settingsExisted: boolean;
  /** Copy of the settings file taken before install, or `null` when it did not exist. */
  backupPath: string | null;
  /** Hook events installed. */
  events: string[];
  /** Absolute path of the installed hook script. */
  hookScript: string;
  /** Node binary used to start the collector (process.execPath at install time). */
  nodePath: string;
  /** Absolute path of the CLI entry used to start the collector. */
  cliPath: string;
  claudeVersion: string | null;
  stillwatchVersion: string;
};

export type StillwatchConfig = {
  v: 1;
  port: number;
  retentionDays: number;
  /** HMAC key for login links and API tokens (base64url, 32 bytes). */
  authSecret: string;
  /** HMAC key for redaction fingerprints (base64url, 32 bytes). */
  fingerprintKey: string;
  createdAt: number;
  install: InstallRecord | null;
};

export function createDefaultConfig(now: number): StillwatchConfig {
  return {
    v: 1,
    port: DEFAULT_PORT,
    retentionDays: DEFAULT_RETENTION_DAYS,
    authSecret: randomToken(32),
    fingerprintKey: randomToken(32),
    createdAt: now,
    install: null,
  };
}

export type StillwatchPaths = {
  home: string;
  config: string;
  db: string;
  spool: string;
  /** Hook writes land here first, then move to `spoolNew` with a rename. */
  spoolTmp: string;
  /** Complete records waiting for import. */
  spoolNew: string;
  bin: string;
  hookScript: string;
  backups: string;
  run: string;
  pidFile: string;
  logs: string;
  logFile: string;
  /** A stable copy of the CLI, made when it was installed from a temporary cache like npx. */
  app: string;
};

/** Directory layout under the Stillwatch home. Pure string joins. */
export function stillwatchPaths(stillwatchHome: string): StillwatchPaths {
  const home = joinPath(stillwatchHome);
  return {
    home,
    config: joinPath(home, 'config.json'),
    db: joinPath(home, 'stillwatch.db'),
    spool: joinPath(home, 'spool'),
    spoolTmp: joinPath(home, 'spool', 'tmp'),
    spoolNew: joinPath(home, 'spool', 'new'),
    bin: joinPath(home, 'bin'),
    hookScript: joinPath(home, 'bin', 'hook.sh'),
    backups: joinPath(home, 'backups'),
    run: joinPath(home, 'run'),
    pidFile: joinPath(home, 'run', 'collector.pid'),
    logs: joinPath(home, 'logs'),
    logFile: joinPath(home, 'logs', 'collector.log'),
    app: joinPath(home, 'app'),
  };
}

/** Environment variable that overrides the Stillwatch home directory. */
export const STILLWATCH_HOME_ENV = 'STILLWATCH_HOME';

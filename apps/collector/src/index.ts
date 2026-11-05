/**
 * @stillwatch/collector
 *
 * The background service (ADR-005, ADR-012, ADR-013). It owns:
 * - the data directory, config, and the spool format (including the capture
 *   hook script that `stillwatch install` writes),
 * - the import pipeline: spool file -> adapt -> redact -> facts -> truncate ->
 *   store, then delete the spool file,
 * - snapshots: a start snapshot when it first sees a session (only if that
 *   event is fresh, see TIMING.snapshotFreshMs), an end snapshot on
 *   session.end or when a sweep closes the session, a `current` snapshot for
 *   live diffs of active sessions,
 * - analysis scheduling (debounced per session) and status sweeps,
 * - retention, and the local HTTP server (API plus the built dashboard).
 *
 * Public API contract. Signatures are fixed; implementations replace the stubs.
 */
import type { StillwatchConfig } from '@stillwatch/schema';
import type { Store } from '@stillwatch/storage';

export type LogFields = Record<string, string | number | boolean | null>;
export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
};

// ---------------------------------------------------------------------------
// Data directory and config
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Capture hook script
// ---------------------------------------------------------------------------

export type HookScriptOptions = {
  stillwatchHome: string;
  /** Node binary that starts the collector when it is not running. */
  nodePath: string;
  /** CLI entry script that accepts `start --quiet`. */
  cliPath: string;
};

/**
 * POSIX sh source of the capture hook (ADR-016). Invoked by Claude Code in
 * exec form as `/bin/sh <hook.sh> <agent> <EventName> [--ensure-collector]`
 * with the payload on stdin. It writes stdin to `spool/tmp/<agent>.<Event>.XXXXXXXXXX`
 * (mktemp, mode 0600), renames it into `spool/new/`, optionally starts the
 * collector in the background, and always exits 0 without writing to stdout.
 * Embedded paths are single-quoted with proper escaping.
 */
export function renderHookScript(_options: HookScriptOptions): string {
  throw new Error('not implemented: renderHookScript');
}

// ---------------------------------------------------------------------------
// Pipeline (no HTTP): used by the collector process, the lab, and tests
// ---------------------------------------------------------------------------

export type PipelineOptions = {
  stillwatchHome: string;
  /** The user's home directory, for the persistence surface and path display. Default os.homedir(). */
  userHome?: string;
  /** Include system-level surface entries (crontab, /etc, /Library). Default true; the lab sets false. */
  includeSystemSurface?: boolean;
  /** Injectable clock. */
  now?: () => number;
  logger?: Logger;
  gitBinary?: string;
  /** Overrides for TIMING values. */
  timing?: Partial<{
    snapshotFreshMs: number;
    interruptAfterMs: number;
    abandonAfterMs: number;
    analysisDebounceMs: number;
    liveDiffMinIntervalMs: number;
    sweepIntervalMs: number;
    spoolPollMs: number;
    staleTmpMs: number;
  }>;
};

export type ImportStats = {
  /** Spool files seen. */
  files: number;
  imported: number;
  duplicates: number;
  failed: number;
  snapshots: number;
};

export type Pipeline = {
  readonly store: Store;
  readonly config: StillwatchConfig;
  /** Imports everything currently in spool/new, oldest first. */
  importOnce(): Promise<ImportStats>;
  /** Analyzes every session with pending events. Returns the analyzed session ids. */
  analyzePending(): Promise<string[]>;
  /** Re-analyzes one session now. */
  analyzeSession(sessionId: string): Promise<void>;
  /** Status transitions, end snapshots for closed sessions, stale tmp cleanup, retention. */
  sweep(): Promise<void>;
  close(): Promise<void>;
};

export function createPipeline(_options: PipelineOptions): Promise<Pipeline> {
  return Promise.reject(new Error('not implemented: createPipeline'));
}

// ---------------------------------------------------------------------------
// Collector process: pipeline + spool watcher + timers + HTTP server
// ---------------------------------------------------------------------------

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

/**
 * Starts the collector in this process: takes the single-instance lock
 * (run/collector.pid), binds 127.0.0.1 only, watches the spool, runs timers.
 * Rejects if another live collector holds the lock.
 */
export function runCollector(_options: CollectorOptions): Promise<CollectorHandle> {
  return Promise.reject(new Error('not implemented: runCollector'));
}

export type CollectorProcessStatus = { running: boolean; pid: number | null; port: number | null };

export function collectorStatus(_stillwatchHome: string): Promise<CollectorProcessStatus> {
  return Promise.reject(new Error('not implemented: collectorStatus'));
}

/** Spawns `<nodePath> <cliPath> collector run` detached (own session, stdio to the log file). */
export function startCollectorDetached(_options: {
  stillwatchHome: string;
  nodePath: string;
  cliPath: string;
}): Promise<{ pid: number }> {
  return Promise.reject(new Error('not implemented: startCollectorDetached'));
}

/** Sends SIGTERM and waits for exit. Returns false when no collector was running. */
export function stopCollector(
  _stillwatchHome: string,
  _options?: { timeoutMs?: number },
): Promise<boolean> {
  return Promise.reject(new Error('not implemented: stopCollector'));
}

// ---------------------------------------------------------------------------
// Auth (ADR-013, ADR-022)
// ---------------------------------------------------------------------------

/**
 * Single-use login link for the dashboard:
 * `http://127.0.0.1:<port>/?login=<ts>.<nonce>.<sig>` where
 * sig = base64url(HMAC-SHA256(authSecret, "login\n" + ts + "\n" + nonce)).
 * The dashboard exchanges it at POST /api/auth/exchange for a bearer token
 * `v1.<expiresAt>.<sig>` (sig over "api\n" + expiresAt), valid 30 days.
 * Links expire after 120 seconds and are single-use (nonces kept in memory).
 */
export function createLoginUrl(_config: StillwatchConfig, _options?: { now?: number }): string {
  throw new Error('not implemented: createLoginUrl');
}

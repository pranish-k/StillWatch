/**
 * Shared constants. Versions here are bumped when the meaning of stored
 * derived data changes, so the collector knows when to recompute it.
 */

/** Version of `EventFacts` produced by `@stillwatch/facts`. */
export const FACTS_VERSION = 1;
/** Version of the analysis output produced by `@stillwatch/rules`. */
export const ANALYSIS_VERSION = 1;
/** Version of `SessionReport` produced by `@stillwatch/reports`. */
export const REPORT_VERSION = 1;
/** Version of `SessionSnapshot` produced by `@stillwatch/git-tracker`. */
export const SNAPSHOT_VERSION = 1;

export const DEFAULT_PORT = 7391;
export const DEFAULT_RETENTION_DAYS = 30;
export const MIN_NODE_VERSION = '22.13.0';

/** Data minimization limits. Redaction always runs before truncation. */
export const LIMITS = {
  /** Spool records above this size are rejected and recorded as a capture gap. */
  maxRecordBytes: 16 * 1024 * 1024,
  /** Strings are cut to this length before redaction, to bound regex work. */
  hardStringCap: 1_048_576,
  /** Default cap for any stored string. */
  storedStringMax: 16_384,
  /** Cap for strings inside stored tool responses. */
  storedResponseStringMax: 8_192,
  /** Cap for a stored prompt. */
  promptMax: 16_384,
  /** Cap for a stored assistant message. */
  messageMax: 8_192,
  /** Cap for session titles derived from prompts. */
  titleMax: 120,
  /** Cap for the serialized size of one stored event. */
  storedEventMaxBytes: 65_536,
  /** Arrays longer than this are cut, with a marker item appended. */
  maxArrayItems: 500,
  /** Nesting deeper than this is replaced with a marker. */
  maxJsonDepth: 48,
  /** Shell command text longer than this is not parsed for facts. */
  maxCommandParseLength: 65_536,
} as const;

/** Collector timing defaults, in milliseconds. */
export const TIMING = {
  /** A start snapshot is only taken when the session's first event is at most this old. */
  snapshotFreshMs: 30_000,
  /** A session mid-turn with no activity for this long is marked interrupted. */
  interruptAfterMs: 30 * 60_000,
  /** A session between turns with no activity for this long is closed as finished. */
  abandonAfterMs: 24 * 60 * 60_000,
  /** Debounce between new events and re-analysis of a session. */
  analysisDebounceMs: 1_500,
  /** Minimum interval between live diffs of an active session. */
  liveDiffMinIntervalMs: 30_000,
  /** Interval of the session status sweep. */
  sweepIntervalMs: 60_000,
  /** Fallback poll interval for the spool directory (fs.watch can miss events). */
  spoolPollMs: 2_000,
  /** Files left in spool/tmp longer than this are treated as abandoned writes. */
  staleTmpMs: 10 * 60_000,
} as const;

/**
 * The contract between the collector and `@stillwatch/rules`.
 * `analyzeSession(input: AnalysisInput): AnalysisResult` is a pure function:
 * the collector does all I/O (database, git, clock) and passes data in.
 */
import type { NormalizedEvent } from './events';
import type { EventFacts } from './facts';
import type { Finding, RiskLevel } from './findings';
import type { Redaction } from './redaction';
import type {
  Artifact,
  CaptureGap,
  DomainRecord,
  FileChange,
  SensitiveAccess,
  SessionLink,
  SessionRecord,
  SessionStats,
  SessionStatus,
  UnfinishedItem,
} from './session';
import type { SessionSnapshot, SnapshotDiff } from './snapshot';

/** An event as stored: the normalized event plus storage and derived fields. */
export type StoredEvent = NormalizedEvent & {
  /** Global insertion sequence (also the hash chain order within a session). */
  seq: number;
  /**
   * Display order key within the session, epoch milliseconds. Equal to `ts`,
   * except that a tool result always sorts after its tool call.
   */
  orderTs: number;
  facts: EventFacts;
  redactions: Redaction[];
  /** Hash chain value: sha256(prevHash + "\n" + canonicalJson(event)). */
  hash: string;
};

export type PriorContext = {
  /** Domains seen in sessions that started before this one. */
  knownDomains: string[];
  /**
   * Earlier writes by other sessions to memory notes and agent configuration,
   * keyed by `pathKey(path)`, oldest first.
   */
  noteWriters: Record<string, { sessionId: string; at: number }[]>;
  /** Other sessions active at the same time, with the paths their tool calls wrote. */
  overlapping: { sessionId: string; startedAt: number; lastEventAt: number; writes: string[] }[];
};

export type AnalysisInput = {
  session: SessionRecord;
  /** All events of the session, in display order (`orderTs`, then `seq`). */
  events: StoredEvent[];
  start: SessionSnapshot | null;
  /** End snapshot, or a `current` snapshot for an active session, or `null`. */
  end: SessionSnapshot | null;
  /** Diff from `start` to `end`, computed by the collector with git-tracker. */
  diff: SnapshotDiff | null;
  /** Gaps recorded during capture and import (not by earlier analysis runs). */
  gaps: CaptureGap[];
  prior: PriorContext;
  /** The user's home directory, for path classification. */
  home: string;
  /** Status as determined by the collector for this run. */
  status: SessionStatus;
  now: number;
};

export type AnalysisResult = {
  findings: Finding[];
  fileChanges: FileChange[];
  artifacts: Artifact[];
  /** Links where this session is the target: it loaded or read notes earlier sessions wrote. */
  links: SessionLink[];
  domains: DomainRecord[];
  /** Gaps found by analysis. They replace the previous run's analysis gaps. */
  gaps: CaptureGap[];
  unfinished: UnfinishedItem[];
  sensitiveAccess: SensitiveAccess[];
  stats: SessionStats;
  risk: RiskLevel;
  riskReasons: string[];
  lastAssistantMessage: string | null;
};

/** Output of `deriveSessionStatus` in `@stillwatch/rules`. */
export type SessionStatusResult = {
  status: SessionStatus;
  endReason: string | null;
  /** True when the last turn has not finished (a prompt without a stop, or an open tool call). */
  midTurn: boolean;
};

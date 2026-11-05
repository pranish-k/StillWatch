/**
 * @stillwatch/storage
 *
 * The local SQLite event store (ADR-008), using the built-in `node:sqlite`
 * module so there are no native dependencies. Load it lazily with
 * `process.getBuiltinModule('node:sqlite')` after installing the warning filter
 * from `installSqliteWarningFilter()`, because Node still prints an
 * ExperimentalWarning for it.
 *
 * Database rules:
 * - File mode 0600. WAL journal, synchronous=NORMAL, foreign_keys=ON,
 *   busy_timeout=5000, auto_vacuum=INCREMENTAL (set before the first table).
 * - Migrations are append-only, applied in a transaction, tracked by PRAGMA user_version.
 * - Every write that touches several rows runs in one transaction.
 * - Prepared statements are cached and reused.
 *
 * Hash chain (ADR-014), per session, in insertion order:
 *   seed     = sha256("stillwatch:" + sessionId)
 *   hash(e)  = sha256(prevHash + "\n" + canonicalJson(chainPayload(e)))
 * where chainPayload is the stored event: the NormalizedEvent fields plus
 * `facts` and `redactions`. `verifyChain` recomputes it.
 *
 * Display order: `orderTs` equals `ts`, except that a tool result
 * (`tool.post`, `tool.failure`, `permission.denied`) for a `tool.pre` with the
 * same tool use id sorts at least 0.001 ms after it, whichever arrives first.
 *
 * Session upkeep inside `insertEvents` (one transaction):
 * - Create the session on its first event of any kind (InstructionsLoaded can
 *   arrive before SessionStart). startedAt = min(ts), lastEventAt = max(ts).
 * - cwd: from session.start, else the first event with a cwd. transcriptPath: latest non-null.
 * - projectRoot/projectId/projectName: from `InsertEventInput.projectRoot` when the session has none;
 *   projectId = first 16 hex of sha256(projectRoot); projectName = basename.
 * - model: session.start data.model, then model.switch toModel. permissionMode: latest non-null.
 * - title: a non-null sessionTitle wins; otherwise the first line of the first
 *   `prompt.submit` with origin "user", capped at LIMITS.titleMax.
 * - status: session.end sets "finished", endedAt, endReason. Any later event
 *   (for example a resume) sets "active" again and clears endedAt. An event for
 *   an "interrupted" session sets it back to "active".
 * - agents: subagent.start/stop maintain rows; any event with an unknown agentId
 *   creates one. Events with agentId null belong to MAIN_AGENT_ID.
 * - Mark the session for analysis.
 *
 * Public API contract. Signatures are fixed; implementations replace the stubs.
 */
import type {
  AnalysisResult,
  CaptureGap,
  EventFacts,
  GapSource,
  NormalizedEvent,
  PriorContext,
  Redaction,
  SessionDetail,
  SessionListQuery,
  SessionListResponse,
  SessionRecord,
  SessionSnapshot,
  SessionStatus,
  StoredEvent,
} from '@stillwatch/schema';

export const DB_SCHEMA_VERSION = 1;

export type InsertEventInput = {
  /** Already redacted and truncated. */
  event: NormalizedEvent;
  facts: EventFacts;
  redactions: Redaction[];
  /** Repository root for the event's cwd (resolved by the collector), or null. */
  projectRoot: string | null;
};

export type InsertResult = {
  inserted: number;
  /** Records whose sourceId was already stored (re-import after a crash). */
  duplicates: number;
  sessionIds: string[];
};

export type AnalysisMeta = {
  summary: string;
  /** Highest event seq included in this analysis; newer events keep the session pending. */
  analyzedThroughSeq: number;
  analysisVersion: number;
  status: SessionStatus;
  endReason: string | null;
};

export type ChainVerification = {
  sessionId: string;
  events: number;
  ok: boolean;
  firstBadSeq: number | null;
  reason: string | null;
};

export type StoreOptions = {
  /** Database file path. Parent directory must exist. */
  path: string;
  readonly?: boolean;
  now?: () => number;
};

export type Store = {
  readonly path: string;
  close(): void;

  // Ingest
  insertEvents(items: InsertEventInput[]): InsertResult;
  saveSnapshot(snapshot: SessionSnapshot): void;
  getSnapshot(sessionId: string, kind: 'start' | 'end'): SessionSnapshot | null;
  addGap(gap: CaptureGap): void;
  /** Gaps for a session (or global gaps when `sessionId` is null), oldest first. */
  getGaps(sessionId: string | null, options?: { excludeSource?: GapSource }): CaptureGap[];

  // Analysis
  /** Replaces all derived rows for the session in one transaction (findings, file changes, artifacts, links where target = session, domains, analysis gaps, stats). */
  saveAnalysis(sessionId: string, result: AnalysisResult, meta: AnalysisMeta): void;
  setSessionStatus(
    sessionId: string,
    status: SessionStatus,
    endReason: string | null,
    endedAt: number | null,
  ): void;
  markForAnalysis(sessionId: string): void;
  /** Sessions with events newer than their last analysis, with their highest seq. */
  pendingAnalysis(): { sessionId: string; maxSeq: number }[];
  getPriorContext(sessionId: string): PriorContext;

  // Queries
  getSession(id: string): SessionRecord | null;
  listSessions(query: SessionListQuery): SessionListResponse;
  getSessionDetail(id: string): SessionDetail | null;
  /** All events in display order (`orderTs`, then `seq`). */
  getSessionEvents(sessionId: string): StoredEvent[];
  /** Page of events in display order. The cursor is opaque. */
  listEvents(
    sessionId: string,
    options: { cursor: string | null; limit: number },
  ): { events: StoredEvent[]; nextCursor: string | null };
  getEvent(id: string): StoredEvent | null;
  /** Event id to the ids of findings that cite it, for one session. */
  findingIdsByEvent(sessionId: string): Record<string, string[]>;
  sessionsWithStatus(status: SessionStatus): SessionRecord[];
  lastEventAt(): number | null;

  // Maintenance
  deleteSession(id: string): boolean;
  /** Deletes sessions whose lastEventAt is before `cutoff`. Returns the count. */
  deleteSessionsBefore(cutoff: number): number;
  deleteAll(): void;
  verifyChain(sessionId?: string): ChainVerification[];
  counts(): { sessions: number; events: number; sizeBytes: number };
};

export function openStore(_options: StoreOptions): Store {
  throw new Error('not implemented: openStore');
}

/**
 * Filters Node's ExperimentalWarning for node:sqlite (and only that warning).
 * Idempotent. Call before the first `openStore`.
 */
export function installSqliteWarningFilter(): void {
  throw new Error('not implemented: installSqliteWarningFilter');
}

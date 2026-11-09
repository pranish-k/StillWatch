/**
 * Gathers the input for `analyzeSession` (events, snapshots and their diff,
 * capture gaps, prior context, status), runs it, and stores the result.
 * The rules are pure; all I/O happens here.
 */
import { lstat } from 'node:fs/promises';
import {
  ANALYSIS_VERSION,
  type SessionRecord,
  type SessionSnapshot,
  type SessionStatusResult,
  type SnapshotDiff,
  type StoredEvent,
} from '@stillwatch/schema';
import { recordGap, type PipelineContext } from './context';
import { describeError } from './fs-safe';
import type { SnapshotManager } from './snapshots';

const DIFF_CACHE_MAX = 64;
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;
/** After a failed analysis, background runs skip the session for this long. */
export const ANALYSIS_RETRY_MS = 60_000;

export class Analyzer {
  private readonly diffCache = new Map<string, SnapshotDiff>();
  private readonly failedAt = new Map<string, number>();
  private readonly gapReported = new Set<string>();

  private readonly ctx: PipelineContext;
  private readonly snapshots: SnapshotManager;

  constructor(ctx: PipelineContext, snapshots: SnapshotManager) {
    this.ctx = ctx;
    this.snapshots = snapshots;
  }

  /** Analyzes every session with pending events, one at a time. Returns the analyzed ids. */
  async analyzePending(): Promise<string[]> {
    const done: string[] = [];
    const now = this.ctx.now();
    for (const { sessionId } of this.ctx.store.pendingAnalysis()) {
      const failed = this.failedAt.get(sessionId);
      if (failed !== undefined && now - failed < ANALYSIS_RETRY_MS) continue;
      if (await this.analyzeOne(sessionId)) done.push(sessionId);
    }
    return done;
  }

  /** Analyzes one session. Never throws: a failure is logged and recorded as a gap. */
  async analyzeOne(sessionId: string): Promise<boolean> {
    try {
      const analyzed = await this.run(sessionId);
      this.failedAt.delete(sessionId);
      this.gapReported.delete(sessionId);
      return analyzed;
    } catch (err) {
      this.failedAt.set(sessionId, this.ctx.now());
      this.ctx.logger.error('session analysis failed', { error: describeError(err) });
      if (!this.gapReported.has(sessionId)) {
        this.gapReported.add(sessionId);
        recordGap(this.ctx, {
          sessionId,
          source: 'collector',
          severity: 'warning',
          reason: 'Analysis of this session failed; findings may be incomplete',
        });
      }
      return false;
    }
  }

  /** Latest activity: the last event, or a newer transcript write. */
  async lastActivityAt(session: SessionRecord): Promise<number> {
    let last = session.lastEventAt;
    const path = session.transcriptPath;
    if (!path?.startsWith('/')) return last;
    try {
      // The path comes from session data: only read regular files (never a FIFO or device).
      const info = await lstat(path);
      if (!info.isFile()) return last;
      const summary = await this.ctx.deps.readTranscriptSummary(path, {
        maxBytes: TRANSCRIPT_TAIL_BYTES,
      });
      if (summary.mtimeMs !== null) last = Math.max(last, summary.mtimeMs);
    } catch {
      // A missing or unreadable transcript only means less evidence of activity.
    }
    return last;
  }

  /** Status for one session from its events and activity. */
  async deriveStatus(session: SessionRecord, events: StoredEvent[]): Promise<SessionStatusResult> {
    return this.ctx.deps.deriveSessionStatus({
      events,
      current: session.status,
      lastActivityAt: await this.lastActivityAt(session),
      now: this.ctx.now(),
      interruptAfterMs: this.ctx.timing.interruptAfterMs,
      abandonAfterMs: this.ctx.timing.abandonAfterMs,
    });
  }

  private async run(sessionId: string): Promise<boolean> {
    const { store, deps } = this.ctx;
    const session = store.getSession(sessionId);
    if (!session) return false;
    const events = store.getSessionEvents(sessionId);
    const maxSeq = events.reduce((max, e) => Math.max(max, e.seq), 0);
    const status = await this.deriveStatus(session, events);

    const start = store.getSnapshot(sessionId, 'start');
    let end: SessionSnapshot | null = store.getSnapshot(sessionId, 'end');
    if (status.status === 'active') {
      // A stored end snapshot belongs to an earlier end; a resumed session is compared live.
      end =
        start && session.cwd !== null
          ? await this.snapshots.current(sessionId, session.cwd, events)
          : null;
    } else if (!end && session.status === 'active') {
      // Closing now without an end snapshot: take a late one.
      if (await this.snapshots.takeEnd(sessionId, true)) end = store.getSnapshot(sessionId, 'end');
    }
    const diff = start && end ? await this.diff(start, end) : null;

    const now = this.ctx.now();
    const result = deps.analyzeSession({
      session,
      events,
      start,
      end,
      diff,
      gaps: store.getGaps(sessionId, { excludeSource: 'analysis' }),
      prior: store.getPriorContext(sessionId),
      home: this.ctx.userHome,
      status: status.status,
      now,
    });
    const summary = deps.summarizeSession({
      session,
      status: status.status,
      stats: result.stats,
      findings: result.findings,
      fileChanges: result.fileChanges,
      artifacts: result.artifacts,
      unfinished: result.unfinished,
    });
    const endReason = status.endReason ?? (status.status === 'finished' ? session.endReason : null);
    store.saveAnalysis(sessionId, result, {
      summary,
      analyzedThroughSeq: maxSeq,
      analysisVersion: ANALYSIS_VERSION,
      status: status.status,
      endReason,
    });
    return true;
  }

  /** Diffs two snapshots, caching results by their identity. A failed diff gives null. */
  private async diff(start: SessionSnapshot, end: SessionSnapshot): Promise<SnapshotDiff | null> {
    const key = `${start.sessionId}\n${start.takenAt}\n${end.kind}\n${end.takenAt}`;
    const cached = this.diffCache.get(key);
    if (cached) return cached;
    try {
      const diff = await this.ctx.deps.diffSnapshots(
        start,
        end,
        this.ctx.gitBinary !== undefined ? { gitBinary: this.ctx.gitBinary } : {},
      );
      if (this.diffCache.size >= DIFF_CACHE_MAX) {
        const oldest = this.diffCache.keys().next();
        if (oldest.done !== true) this.diffCache.delete(oldest.value);
      }
      this.diffCache.set(key, diff);
      return diff;
    } catch (err) {
      this.ctx.logger.error('snapshot diff failed', { error: describeError(err) });
      return null;
    }
  }

  forget(sessionId: string): void {
    this.failedAt.delete(sessionId);
    this.gapReported.delete(sessionId);
    for (const key of this.diffCache.keys()) {
      if (key.startsWith(`${sessionId}\n`)) this.diffCache.delete(key);
    }
  }
}

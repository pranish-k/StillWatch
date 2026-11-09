/**
 * Spool import: adapt, redact, extract facts, truncate, store, then delete the
 * spool files (docs/architecture.md, "Import pipeline").
 *
 * Files are deleted only after their events are committed, so a crash between
 * commit and delete re-imports them, and storage ignores them by `sourceId`.
 * Records that can never be imported (bad name, oversized, corrupt) are
 * deleted at once and recorded as capture gaps. Records that fail for an
 * unexpected reason are retried; one is given up on only after repeated
 * failures while other records import fine, so an outage never discards data.
 */
import { readFile } from 'node:fs/promises';
import {
  LIMITS,
  parseSpoolName,
  type EventFacts,
  type NormalizedEvent,
  type Redaction,
} from '@stillwatch/schema';
import type { InsertEventInput } from '@stillwatch/storage';
import { recordGap, type PipelineContext } from './context';
import { describeError, hasErrorCode, removeFile } from './fs-safe';
import type { ImportStats } from './pipeline';
import type { SnapshotManager } from './snapshots';
import { listSpool, type SpoolEntry } from './spool';

export const IMPORT_BATCH_SIZE = 500;
/** Failed attempts after which a record that keeps failing is discarded. */
export const MAX_RECORD_ATTEMPTS = 5;
const REPO_ROOT_CACHE_MAX = 1024;
const REASON_MAX = 160;

/** Fields that identify the event; redaction and truncation must never change them. */
const IDENTITY_POINTERS = new Set(['/id', '/sourceId', '/sessionId']);

type Prepared = { entry: SpoolEntry; input: InsertEventInput };
type Failure = { entry: SpoolEntry; sessionId: string | null; stage: string };

export function emptyStats(): ImportStats {
  return { files: 0, imported: 0, duplicates: 0, failed: 0, snapshots: 0 };
}

export class Importer {
  private readonly repoRoots = new Map<string, Promise<string | null>>();
  private readonly attempts = new Map<string, number>();
  /** Records discarded since the collector started. */
  failedTotal = 0;

  private readonly ctx: PipelineContext;
  private readonly snapshots: SnapshotManager;
  private readonly onImported: (sessionIds: string[]) => void;

  constructor(
    ctx: PipelineContext,
    snapshots: SnapshotManager,
    onImported: (sessionIds: string[]) => void,
  ) {
    this.ctx = ctx;
    this.snapshots = snapshots;
    this.onImported = onImported;
  }

  /** Imports everything currently in spool/new, oldest first, in batches. */
  async importOnce(): Promise<ImportStats> {
    const stats = emptyStats();
    const entries = await listSpool(this.ctx.paths.spoolNew);
    stats.files = entries.length;
    for (let i = 0; i < entries.length; i += IMPORT_BATCH_SIZE) {
      await this.importBatch(entries.slice(i, i + IMPORT_BATCH_SIZE), stats);
    }
    this.failedTotal += stats.failed;
    if (stats.files > 0) {
      this.ctx.logger.debug('spool import', { ...stats });
    }
    return stats;
  }

  private async importBatch(batch: SpoolEntry[], stats: ImportStats): Promise<void> {
    const prepared: Prepared[] = [];
    const failures: Failure[] = [];
    for (const entry of batch) {
      const result = await this.prepare(entry, stats);
      if (result === null) continue;
      if ('input' in result) prepared.push(result);
      else failures.push(result);
    }

    // Sessions this batch creates, with their first event (entries are oldest first).
    const firstEvents = new Map<string, NormalizedEvent>();
    for (const { input } of prepared) {
      const { sessionId } = input.event;
      if (!firstEvents.has(sessionId) && this.ctx.store.getSession(sessionId) === null) {
        firstEvents.set(sessionId, input.event);
      }
    }

    const committed = this.insert(prepared, failures, stats);
    await this.handleFailures(failures, committed.length > 0, stats);
    for (const { entry } of committed) {
      this.attempts.delete(entry.name);
      await this.remove(entry);
    }

    for (const [sessionId, first] of firstEvents) {
      const session = this.ctx.store.getSession(sessionId);
      if (!session) continue;
      if (await this.snapshots.onFirstEvent(sessionId, first.ts, session.cwd ?? first.cwd)) {
        stats.snapshots++;
      }
    }
    stats.snapshots += await this.endSnapshots(committed);

    const sessionIds = new Set(committed.map((p) => p.input.event.sessionId));
    if (sessionIds.size > 0) this.onImported([...sessionIds]);
  }

  /** Takes end snapshots for sessions that ended in this batch and are still finished. */
  private async endSnapshots(committed: Prepared[]): Promise<number> {
    const lastEnd = new Map<string, number>();
    for (const { input } of committed) {
      if (input.event.kind === 'session.end') lastEnd.set(input.event.sessionId, input.event.ts);
    }
    let taken = 0;
    for (const [sessionId, endTs] of lastEnd) {
      const session = this.ctx.store.getSession(sessionId);
      if (session?.status !== 'finished') continue;
      const existing = this.ctx.store.getSnapshot(sessionId, 'end');
      if (existing && existing.takenAt >= endTs) continue;
      const late = this.ctx.now() - endTs > this.ctx.timing.snapshotFreshMs;
      if (await this.snapshots.takeEnd(sessionId, late)) taken++;
    }
    return taken;
  }

  /**
   * Reads and processes one spool file. Returns the insert input, a failure
   * to retry, or null when the file was skipped or discarded.
   */
  private async prepare(entry: SpoolEntry, stats: ImportStats): Promise<Prepared | Failure | null> {
    if (!entry.regular) {
      this.ctx.logger.warn('ignoring non-regular spool entry');
      return null;
    }
    const name = parseSpoolName(entry.name);
    if (!name) {
      await this.discard(
        entry,
        null,
        'A spool file with an unrecognized name was discarded',
        stats,
      );
      return null;
    }
    if (entry.size > LIMITS.maxRecordBytes) {
      await this.discard(entry, null, 'An oversized hook record was discarded', stats);
      return null;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(entry.path);
    } catch (err) {
      if (hasErrorCode(err, 'ENOENT')) return null;
      this.ctx.logger.error('reading spool file failed', { error: describeError(err) });
      return { entry, sessionId: null, stage: 'read' };
    }
    if (bytes.length > LIMITS.maxRecordBytes) {
      await this.discard(entry, null, 'An oversized hook record was discarded', stats);
      return null;
    }

    let event: NormalizedEvent;
    try {
      const adapted = this.ctx.deps.adapt({
        sourceId: entry.name,
        eventHint: name.eventHint,
        receivedAt: entry.receivedAt,
        body: bytes.toString('utf8'),
      });
      if (!adapted.ok) {
        const reason = adapted.reason.replace(/\s+/g, ' ').slice(0, REASON_MAX);
        await this.discard(
          entry,
          adapted.sessionId,
          `A hook record could not be read and was discarded: ${reason}`,
          stats,
        );
        return null;
      }
      event = adapted.event;
    } catch (err) {
      this.ctx.logger.error('adapter threw', { error: describeError(err) });
      return { entry, sessionId: null, stage: 'adapt' };
    }

    try {
      return { entry, input: await this.process(event) };
    } catch (err) {
      this.ctx.logger.error('processing event failed', { error: describeError(err) });
      return { entry, sessionId: event.sessionId, stage: 'process' };
    }
  }

  /** Redact, extract facts on the redacted untruncated event, truncate, resolve the project. */
  private async process(event: NormalizedEvent): Promise<InsertEventInput> {
    const { deps, redactor } = this.ctx;
    const redacted = redactor.redactJson(event);
    const clean = withIdentity(redacted.value, event);
    const redactions: Redaction[] = redacted.redactions.filter(
      (r) => !IDENTITY_POINTERS.has(r.pointer),
    );
    const facts: EventFacts = deps.extractFacts(clean, {
      home: this.ctx.userHome,
      stillwatchHome: this.ctx.stillwatchHome,
    });
    const truncated = deps.truncateJson(clean, {
      maxString: LIMITS.storedStringMax,
      maxArrayItems: LIMITS.maxArrayItems,
      maxDepth: LIMITS.maxJsonDepth,
      maxTotalBytes: LIMITS.storedEventMaxBytes,
      overrides: [
        { pointerPrefix: '/tool/response', maxString: LIMITS.storedResponseStringMax },
        { pointerPrefix: '/data/prompt', maxString: LIMITS.promptMax },
        { pointerPrefix: '/data/lastMessage', maxString: LIMITS.messageMax },
      ],
    });
    const stored = withIdentity(truncated.value, event);
    return { event: stored, facts, redactions, projectRoot: await this.projectRootFor(stored.cwd) };
  }

  /** Repository root for a cwd (cached), else the cwd itself. */
  private async projectRootFor(cwd: string | null): Promise<string | null> {
    if (!cwd?.startsWith('/')) return null;
    let pending = this.repoRoots.get(cwd);
    if (!pending) {
      if (this.repoRoots.size >= REPO_ROOT_CACHE_MAX) this.repoRoots.clear();
      const options = this.ctx.gitBinary !== undefined ? { gitBinary: this.ctx.gitBinary } : {};
      pending = this.ctx.deps.findRepoRoot(cwd, options).catch((err: unknown) => {
        this.ctx.logger.warn('finding repository root failed', { error: describeError(err) });
        return null;
      });
      this.repoRoots.set(cwd, pending);
    }
    return (await pending) ?? cwd;
  }

  /**
   * Inserts the batch in one transaction. If that fails, retries record by
   * record so one bad record cannot block the rest. Returns what was committed.
   * Throws when nothing could be stored (likely a database problem).
   */
  private insert(prepared: Prepared[], failures: Failure[], stats: ImportStats): Prepared[] {
    if (prepared.length === 0) return [];
    try {
      const result = this.ctx.store.insertEvents(prepared.map((p) => p.input));
      stats.imported += result.inserted;
      stats.duplicates += result.duplicates;
      return prepared;
    } catch (err) {
      this.ctx.logger.error('batch insert failed; retrying records one by one', {
        records: prepared.length,
        error: describeError(err),
      });
    }
    const committed: Prepared[] = [];
    const failed: Prepared[] = [];
    for (const item of prepared) {
      try {
        const result = this.ctx.store.insertEvents([item.input]);
        stats.imported += result.inserted;
        stats.duplicates += result.duplicates;
        committed.push(item);
      } catch {
        failed.push(item);
      }
    }
    if (committed.length === 0) {
      throw new Error(`storing ${failed.length} events failed`);
    }
    for (const item of failed) {
      failures.push({ entry: item.entry, sessionId: item.input.event.sessionId, stage: 'store' });
    }
    return committed;
  }

  /**
   * Counts an attempt for each failed record. Attempts only count when other
   * records succeeded in the same batch, so a systemic failure never discards data.
   */
  private async handleFailures(
    failures: Failure[],
    anySuccess: boolean,
    stats: ImportStats,
  ): Promise<void> {
    if (!anySuccess) return;
    for (const failure of failures) {
      const attempts = (this.attempts.get(failure.entry.name) ?? 0) + 1;
      if (attempts < MAX_RECORD_ATTEMPTS) {
        this.attempts.set(failure.entry.name, attempts);
        continue;
      }
      this.attempts.delete(failure.entry.name);
      await this.discard(
        failure.entry,
        failure.sessionId,
        `A hook record failed to import (${failure.stage}) ${attempts} times and was discarded`,
        stats,
      );
    }
  }

  /** Deletes a record that cannot be imported and records a capture gap. */
  private async discard(
    entry: SpoolEntry,
    sessionId: string | null,
    reason: string,
    stats: ImportStats,
  ): Promise<void> {
    stats.failed++;
    recordGap(this.ctx, {
      sessionId,
      source: 'spool',
      severity: 'warning',
      reason,
      startedAt: entry.receivedAt,
      endedAt: entry.receivedAt,
    });
    this.ctx.logger.warn('discarded spool record', { attributed: sessionId !== null });
    await this.remove(entry);
  }

  private async remove(entry: SpoolEntry): Promise<void> {
    try {
      await removeFile(entry.path);
    } catch (err) {
      this.ctx.logger.error('removing spool file failed', { error: describeError(err) });
    }
  }
}

/** Puts the original identity fields back, so redaction and truncation never change them. */
function withIdentity(value: NormalizedEvent, original: NormalizedEvent): NormalizedEvent {
  return {
    ...value,
    id: original.id,
    sourceId: original.sourceId,
    sessionId: original.sessionId,
  };
}

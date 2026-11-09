/**
 * Periodic upkeep: session status transitions (with late end snapshots for
 * sessions that close without one), cleanup of abandoned hook writes in
 * spool/tmp, and retention. Each step is independent; a failing step is
 * logged and the others still run.
 */
import { DAY_MS, recordGap, type PipelineContext } from './context';
import type { Analyzer } from './analyzer';
import { describeError, removeFile } from './fs-safe';
import type { SnapshotManager } from './snapshots';
import { listSpool } from './spool';

export type SweepHooks = {
  /** Called for each session whose status changed. */
  onStatusChanged: (sessionId: string) => void;
  /** Called after retention deleted sessions, so in-memory state can be pruned. */
  onRetention: () => void;
};

export async function sweep(
  ctx: PipelineContext,
  analyzer: Analyzer,
  snapshots: SnapshotManager,
  hooks: SweepHooks,
): Promise<void> {
  await step(ctx, 'status sweep', () => sweepStatuses(ctx, analyzer, snapshots, hooks));
  await step(ctx, 'stale tmp cleanup', () => removeStaleTmp(ctx));
  await step(ctx, 'retention', () => {
    const cutoff = ctx.now() - ctx.config.retentionDays * DAY_MS;
    const deleted = ctx.store.deleteSessionsBefore(cutoff);
    if (deleted > 0) {
      ctx.logger.info('retention deleted sessions', { deleted });
      hooks.onRetention();
    }
    return Promise.resolve();
  });
}

async function step(ctx: PipelineContext, name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    ctx.logger.error(`${name} failed`, { error: describeError(err) });
  }
}

async function sweepStatuses(
  ctx: PipelineContext,
  analyzer: Analyzer,
  snapshots: SnapshotManager,
  hooks: SweepHooks,
): Promise<void> {
  for (const session of ctx.store.sessionsWithStatus('active')) {
    try {
      const events = ctx.store.getSessionEvents(session.id);
      const result = await analyzer.deriveStatus(session, events);
      if (result.status === session.status) continue;
      const closedAt = result.status === 'active' ? null : await analyzer.lastActivityAt(session);
      ctx.store.setSessionStatus(session.id, result.status, result.endReason, closedAt);
      ctx.logger.info('session status changed', { status: result.status });
      if (result.status !== 'active' && ctx.store.getSnapshot(session.id, 'end') === null) {
        await snapshots.takeEnd(session.id, true);
      }
      ctx.store.markForAnalysis(session.id);
      hooks.onStatusChanged(session.id);
    } catch (err) {
      ctx.logger.error('status transition failed', { error: describeError(err) });
    }
  }
}

/** Deletes spool/tmp files older than `staleTmpMs` (hook writes that never finished). */
async function removeStaleTmp(ctx: PipelineContext): Promise<void> {
  const cutoff = ctx.now() - ctx.timing.staleTmpMs;
  let removed = 0;
  let oldest: number | null = null;
  for (const entry of await listSpool(ctx.paths.spoolTmp)) {
    if (!entry.regular || entry.receivedAt >= cutoff) continue;
    if (await removeFile(entry.path)) {
      removed++;
      oldest = oldest === null ? entry.receivedAt : Math.min(oldest, entry.receivedAt);
    }
  }
  if (removed > 0) {
    recordGap(ctx, {
      sessionId: null,
      source: 'spool',
      severity: 'warning',
      reason: `${removed} unfinished hook write${removed === 1 ? ' was' : 's were'} abandoned and removed`,
      startedAt: oldest,
    });
    ctx.logger.warn('removed stale spool tmp files', { removed });
  }
}

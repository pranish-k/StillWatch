/** Capture gaps found by analysis. They are shown in reports, never hidden. */
import type { CaptureGap } from '@stillwatch/schema';
import type { RuleContext } from './context';
import { stableId } from './ids';

const WRITE_OPS = new Set(['write', 'delete', 'chmod']);
const MAX_ERRORS_LISTED = 3;

export function buildGaps(ctx: RuleContext): CaptureGap[] {
  const { input, sessionId } = ctx;
  const out: CaptureGap[] = [];
  const gap = (
    key: string,
    fields: Pick<CaptureGap, 'source' | 'severity' | 'reason'> & { startedAt?: number | null },
  ): void => {
    out.push({
      id: stableId(sessionId, 'gap', key),
      sessionId,
      source: fields.source,
      severity: fields.severity,
      startedAt: fields.startedAt ?? null,
      endedAt: null,
      reason: fields.reason,
      createdAt: input.now,
    });
  };
  const writes = ctx.accesses.some((a) => a.effective && WRITE_OPS.has(a.access.op));
  if (input.session.projectRoot !== null && input.start === null && writes) {
    gap('no_start_snapshot', {
      source: 'snapshot',
      severity: 'critical',
      startedAt: input.session.startedAt,
      reason:
        'No start snapshot was taken for this repository session, so changes that no recorded tool call explains cannot be detected.',
    });
  }
  if (input.start?.late === true) {
    gap('late_start_snapshot', {
      source: 'snapshot',
      severity: 'warning',
      startedAt: input.session.startedAt,
      reason:
        'The start snapshot was taken late, so changes made before it are part of the baseline and not shown.',
    });
  }
  if (input.status === 'finished' && input.end?.kind !== 'end') {
    gap('no_end_snapshot', {
      source: 'snapshot',
      severity: 'warning',
      reason:
        'The session finished without an end snapshot, so the final state of files was not compared.',
    });
  }
  const orphans = ctx.calls.filter(
    (g) => g.pre === null && (g.post !== null || g.failure !== null),
  );
  if (orphans.length > 0) {
    gap('tool_results_without_call', {
      source: 'hooks',
      severity: 'warning',
      startedAt: orphans[0]?.first.ts ?? null,
      reason: `${orphans.length} tool result${orphans.length === 1 ? ' has' : 's have'} no recorded tool call, so some hook events were missed.`,
    });
  }
  const errors = input.diff?.errors ?? [];
  if (errors.length > 0) {
    const listed = errors.slice(0, MAX_ERRORS_LISTED).join('; ');
    gap('diff_errors', {
      source: 'snapshot',
      severity: 'info',
      reason: `Comparing snapshots reported ${errors.length} error${errors.length === 1 ? '' : 's'}: ${listed}${errors.length > MAX_ERRORS_LISTED ? '; ...' : ''}`,
    });
  }
  return out;
}

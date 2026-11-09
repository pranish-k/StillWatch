/** Evidence: changes snapshots saw that no recorded action explains. */
import { isPersistenceClass } from '../classes';
import type { FindingDraft, RuleFn } from '../findings';
import { changeDraft, show, verb } from './common';

/** More ordinary unattributed changes than this are reported as one finding. */
const AGGREGATE_ABOVE = 20;

export const unattributedChange: RuleFn = (ctx) => {
  const out: FindingDraft[] = [];
  const ordinary = [];
  for (const c of ctx.pathChanges) {
    if (c.attribution !== 'unattributed' || (c.diff === null && c.surface === null)) continue;
    if (isPersistenceClass(c.classes)) {
      out.push(
        changeDraft(ctx, c, {
          ruleId: 'evidence.unattributed_change',
          severity: 'medium',
          title: 'Persistent file changed with no recorded action',
          reason: `The snapshots show ${show(ctx, c.path)} was ${verb(c)}, but no tool call or command in this session explains it. Another program or person may have changed it, or Stillwatch missed an event.`,
        }),
      );
    } else ordinary.push(c);
  }
  const why =
    'no tool call or command in this session explains them. Another program or person may have changed them, or Stillwatch missed an event.';
  if (ordinary.length > AGGREGATE_ABOVE) {
    const first = ordinary[0];
    if (first !== undefined) {
      const draft = changeDraft(ctx, first, {
        ruleId: 'evidence.unattributed_change',
        severity: 'low',
        title: `${ordinary.length} changes with no recorded action`,
        reason: `The snapshots show ${ordinary.length} files changed, but ${why}`,
        subject: 'aggregate',
      });
      draft.paths = ordinary.map((c) => c.path);
      out.push(draft);
    }
  } else {
    for (const c of ordinary) {
      out.push(
        changeDraft(ctx, c, {
          ruleId: 'evidence.unattributed_change',
          severity: 'low',
          title: 'Change with no recorded action',
          reason: `The snapshots show ${show(ctx, c.path)} was ${verb(c)}, but no tool call or command in this session explains it. Another program or person may have changed it, or Stillwatch missed an event.`,
        }),
      );
    }
  }
  return out;
};

/** Network: domains no earlier session contacted. */
import { isLocalDomain, isWellKnownDomain } from '../domains';
import type { FindingDraft, RuleFn } from '../findings';
import { eventDraft } from './common';

export const newDomain: RuleFn = (ctx) => {
  const out: FindingDraft[] = [];
  for (const record of ctx.domains) {
    if (!record.isNew || isWellKnownDomain(record.domain) || isLocalDomain(record.domain)) continue;
    const events = ctx.networkCalls
      .filter((n) => n.effective && n.domains.includes(record.domain))
      .map((n) => n.group.first);
    out.push(
      eventDraft(events, {
        ruleId: 'network.new_domain',
        severity: 'low',
        title: 'New domain contacted',
        reason: `The session contacted ${record.domain} through ${record.via.join(', ')}, a domain no earlier session used.`,
        subject: record.domain,
      }),
    );
  }
  return out;
};

/** Secrets: reading credentials and sending them off the computer. */
import type { StoredEvent } from '@stillwatch/schema';
import type { RuleContext } from '../context';
import { isLocalDomain, isNetworkCapable, isWellKnownDomain } from '../domains';
import type { FindingDraft, RuleFn } from '../findings';
import { actionSignals, eventDraft, show } from './common';

/** Medium: reads of secret-class paths and commands that print credentials. */
export const secretRead: RuleFn = (ctx) => {
  const out: FindingDraft[] = [];
  for (const a of ctx.accesses) {
    if (!a.effective || a.access.op !== 'read' || !a.classification.classes.includes('secret')) {
      continue;
    }
    const label = a.classification.label === null ? '' : ` (${a.classification.label})`;
    out.push(
      eventDraft([a.event], {
        ruleId: 'secret.read',
        severity: 'medium',
        title: 'Secret file read',
        reason: `The agent read ${show(ctx, a.access.path)}${label}, which holds credentials. Its contents are now in the agent context.`,
        subject: a.key,
        paths: [a.access.path],
      }),
    );
  }
  for (const s of actionSignals(ctx, 'credential_command')) {
    out.push(
      eventDraft([s.event], {
        ruleId: 'secret.read',
        severity: 'medium',
        title: 'Credentials printed by a command',
        reason: `The agent ran a command that prints credentials (${s.signal.detail}). Its output is now in the agent context.`,
        subject: `command:${s.signal.detail}`,
      }),
    );
  }
  return out;
};

function isSecretRead(ctx: RuleContext, event: StoredEvent): boolean {
  return (
    ctx.accesses.some(
      (a) =>
        a.event === event &&
        a.effective &&
        a.access.op === 'read' &&
        a.classification.classes.includes('secret'),
    ) ||
    event.facts.signals.some((s) => s.kind === 'credential_command' && s.source === 'tool.input')
  );
}

/**
 * High: a secret in a network-capable call, or a secret first seen in a tool
 * result later sent in a network-capable call's input. Medium: a secret read
 * followed by contact with a new domain.
 */
export const secretExfiltration: RuleFn = (ctx) => {
  const out: FindingDraft[] = [];
  const firstInResponse = new Map<string, StoredEvent>();
  const networkByEvent = new Map(ctx.networkCalls.map((n) => [n.event.id, n]));
  const known = new Set(ctx.input.prior.knownDomains.map((d) => d.toLowerCase()));
  let firstSecretRead: StoredEvent | null = null;

  for (const { event, effective } of ctx.counted) {
    const tool = event.tool;
    const readsSecret = effective && isSecretRead(ctx, event);
    if (effective && tool !== null && isNetworkCapable(event)) {
      const where = tool.category === 'shell' ? 'a command' : `the ${tool.name} tool`;
      const domains = networkByEvent.get(event.id)?.domains ?? [];
      const to = domains.length > 0 ? ` to ${domains.join(', ')}` : '';
      const inputFps = event.facts.secrets.filter((s) => s.where === 'tool.input');
      let high = false;
      if (event.facts.signals.some((s) => s.kind === 'secret_in_command')) {
        const fp = inputFps[0];
        high = true;
        out.push(
          eventDraft([event], {
            ruleId: 'secret.exfiltration',
            severity: 'high',
            title: 'Secret sent over the network',
            reason: `A secret${fp === undefined ? '' : ` (${fp.detector})`} appears in ${where} that can reach the network${to}.`,
            subject: fp === undefined ? `event:${event.id}` : `secret:${fp.fingerprint}`,
          }),
        );
      }
      for (const fp of inputFps) {
        const source = firstInResponse.get(fp.fingerprint);
        if (source === undefined) continue;
        high = true;
        out.push(
          eventDraft([source, event], {
            ruleId: 'secret.exfiltration',
            severity: 'high',
            title: 'Secret from tool output sent over the network',
            reason: `A secret (${fp.detector}) first appeared in the output of ${source.tool?.name ?? 'a tool'}, then was sent in ${where}${to}.`,
            subject: `secret:${fp.fingerprint}`,
          }),
        );
      }
      // A read in the same call (`cat .env | curl ...`) counts as well as an earlier one.
      const readEvent = firstSecretRead ?? (readsSecret ? event : null);
      if (!high && readEvent !== null) {
        const sameCall = readEvent === event;
        for (const domain of domains) {
          if (known.has(domain) || isWellKnownDomain(domain) || isLocalDomain(domain)) continue;
          out.push(
            eventDraft(sameCall ? [event] : [readEvent, event], {
              ruleId: 'secret.exfiltration',
              severity: 'medium',
              title: sameCall
                ? 'Secret read and new domain contacted in one call'
                : 'New domain contacted after a secret was read',
              reason: sameCall
                ? `${where[0]?.toUpperCase() ?? ''}${where.slice(1)} read a secret and contacted ${domain}, a domain no earlier session used. The secret could have been sent there.`
                : `After reading a secret, the agent contacted ${domain}, a domain no earlier session used. The secret could have been sent there.`,
              subject: `after-read:${domain}`,
            }),
          );
        }
      }
    }
    for (const s of event.facts.secrets) {
      if (s.where === 'tool.response' && !firstInResponse.has(s.fingerprint)) {
        firstInResponse.set(s.fingerprint, event);
      }
    }
    if (firstSecretRead === null && readsSecret) firstSecretRead = event;
  }
  return out;
};

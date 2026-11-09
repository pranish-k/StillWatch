/** Possible prompt injection in content from untrusted sources. Escalation lives in finalizeFindings. */
import type { StoredEvent } from '@stillwatch/schema';
import type { FindingDraft, RuleFn } from '../findings';
import { eventDraft } from './common';

function untrusted(event: StoredEvent, source: string): boolean {
  if (source === 'tool.response' || source === 'data') return true;
  return source === 'prompt' && event.kind === 'prompt.submit' && event.data.origin !== 'user';
}

function sourceName(event: StoredEvent): string {
  if (event.tool !== null) return `the ${event.tool.name} tool`;
  if (event.kind === 'prompt.submit') return `a ${event.data.origin.replace('_', ' ')} prompt`;
  if (event.kind === 'instructions.loaded') return 'loaded instructions';
  return 'session data';
}

/** One finding per event and signal kind, so one poisoned file does not produce a finding per phrase. */
export const promptInjection: RuleFn = (ctx) => {
  const groups = new Map<string, { event: StoredEvent; kind: string; details: string[] }>();
  for (const { event, signal } of ctx.signals) {
    if (signal.kind !== 'prompt_injection' && signal.kind !== 'hidden_text') continue;
    if (!untrusted(event, signal.source)) continue;
    const key = `${event.id}\u0000${signal.kind}`;
    const group = groups.get(key) ?? { event, kind: signal.kind, details: [] };
    if (!group.details.includes(signal.detail)) group.details.push(signal.detail);
    groups.set(key, group);
  }
  const out: FindingDraft[] = [];
  for (const { event, kind, details } of groups.values()) {
    const hidden = kind === 'hidden_text';
    const first = details[0] ?? '';
    const more = details.length > 1 ? ` and ${details.length - 1} more` : '';
    out.push(
      eventDraft([event], {
        ruleId: 'prompt_injection.possible',
        severity: 'medium',
        title: hidden ? 'Hidden text in content the agent read' : 'Possible prompt injection',
        reason: `Content that reached the agent through ${sourceName(event)} contains ${hidden ? 'hidden text' : 'instruction-like text aimed at an agent'} ("${first}"${more}).`,
        subject: `${kind}:${first.toLowerCase()}`,
      }),
    );
  }
  return out;
};

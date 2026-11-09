/** Session statistics. */
import type { SessionStats } from '@stillwatch/schema';
import type { RuleContext } from './context';

export function buildStats(ctx: RuleContext): SessionStats {
  const byCategory: Record<string, number> = {};
  let commands = 0;
  for (const g of ctx.calls) {
    if (g.pre === null && g.post === null && g.failure === null) continue;
    byCategory[g.category] = (byCategory[g.category] ?? 0) + 1;
    if (g.category === 'shell') commands += 1;
  }
  const read = new Set<string>();
  const written = new Set<string>();
  for (const a of ctx.accesses) {
    if (!a.effective) continue;
    if (a.access.op === 'read') read.add(a.key);
    else if (a.access.op === 'write' || a.access.op === 'delete') written.add(a.key);
  }
  let failures = 0;
  let prompts = 0;
  let turns = 0;
  let permissionRequests = 0;
  let denials = 0;
  const subagents = new Set<string>();
  for (const e of ctx.events) {
    if (e.agentId !== null) subagents.add(e.agentId);
    if (e.kind === 'tool.failure') failures += 1;
    else if (e.kind === 'prompt.submit' && e.data.origin === 'user') prompts += 1;
    else if (e.kind === 'turn.stop' || e.kind === 'turn.failure') turns += 1;
    else if (e.kind === 'permission.request') permissionRequests += 1;
    else if (e.kind === 'permission.denied') denials += 1;
    else if (e.kind === 'subagent.start') subagents.add(e.data.subagentId);
  }
  const first = ctx.events[0];
  const last = ctx.events[ctx.events.length - 1];
  return {
    toolCalls: Object.values(byCategory).reduce((a, b) => a + b, 0),
    byCategory,
    filesRead: read.size,
    filesWritten: written.size,
    commands,
    failures,
    prompts,
    turns,
    subagents: subagents.size,
    permissionRequests,
    denials,
    durationMs: first === undefined || last === undefined ? null : last.ts - first.ts,
  };
}

/** Unfinished work: open tasks, an unfinished turn, open tool calls, background tasks, crons. */
import type { UnfinishedItem } from '@stillwatch/schema';
import { isRunning } from './artifacts';
import type { RuleContext } from './context';
import { firstLine } from './text';
import { turnState } from './turns';

export function buildUnfinished(ctx: RuleContext): UnfinishedItem[] {
  const out: UnfinishedItem[] = [];
  const created = new Map<string, UnfinishedItem>();
  for (const e of ctx.events) {
    if (e.kind === 'task.created') {
      const label = e.data.subject ?? e.data.description ?? e.data.taskId;
      created.set(e.data.taskId, { kind: 'task', label: firstLine(label), eventId: e.id });
    } else if (e.kind === 'task.completed') created.delete(e.data.taskId);
  }
  out.push(...created.values());
  const state = turnState(ctx.events, ctx.calls);
  if (state.openPrompt !== null) {
    out.push({
      kind: 'turn',
      label: firstLine(state.openPrompt.data.prompt),
      eventId: state.openPrompt.id,
    });
  }
  for (const g of state.openCalls) {
    const t = g.tool;
    const target = t.command ?? t.filePath ?? t.url;
    out.push({
      kind: 'tool_call',
      label: firstLine(target === null ? t.name : `${t.name}: ${target}`),
      eventId: g.first.id,
    });
  }
  const stop = ctx.lastTurnStop;
  if (stop !== null) {
    for (const t of stop.data.backgroundTasks) {
      if (!isRunning(t.status)) continue;
      out.push({
        kind: 'background_task',
        label: firstLine(t.description ?? t.command ?? t.id),
        eventId: stop.id,
      });
    }
    for (const c of stop.data.sessionCrons) {
      const label = `${c.schedule ?? c.id}${c.prompt === null ? '' : `: ${c.prompt}`}`;
      out.push({ kind: 'session_cron', label: firstLine(label), eventId: stop.id });
    }
  }
  return out;
}

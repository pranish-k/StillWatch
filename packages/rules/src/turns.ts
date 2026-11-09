/** Turn state: whether the last turn finished, shared by status and unfinished work. */
import type { StoredEvent } from '@stillwatch/schema';
import { groupToolCalls, type ToolCallGroup } from './context';

export type TurnState = {
  /** The last prompt, when no turn.stop or turn.failure followed it. */
  openPrompt: Extract<StoredEvent, { kind: 'prompt.submit' }> | null;
  /** Tool calls with no result, denial, or batch resolution. */
  openCalls: ToolCallGroup[];
  /** True when the last turn has not finished. */
  midTurn: boolean;
};

export function turnState(
  events: readonly StoredEvent[],
  calls?: readonly ToolCallGroup[],
): TurnState {
  let lastEnd = -1;
  let lastPromptIndex = -1;
  let lastPrompt: TurnState['openPrompt'] = null;
  const indexOf = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e === undefined) continue;
    indexOf.set(e.id, i);
    if (e.kind === 'turn.stop' || e.kind === 'turn.failure') lastEnd = i;
    if (e.kind === 'prompt.submit') {
      lastPromptIndex = i;
      lastPrompt = e;
    }
  }
  const groups = calls ?? groupToolCalls(events).calls;
  const openCalls = groups.filter(
    (g) =>
      g.pre !== null &&
      g.post === null &&
      g.failure === null &&
      g.denied === null &&
      !g.resolvedByBatch,
  );
  const openPrompt = lastPromptIndex > lastEnd ? lastPrompt : null;
  const openInTurn = openCalls.some(
    (g) => (g.pre === null ? -1 : (indexOf.get(g.pre.id) ?? -1)) > lastEnd,
  );
  return { openPrompt, openCalls, midTurn: openPrompt !== null || openInTurn };
}

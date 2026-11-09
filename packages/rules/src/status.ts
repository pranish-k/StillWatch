/** Session status from events and activity. */
import { TIMING, type SessionStatusResult } from '@stillwatch/schema';
import type { StatusInput } from './index';
import { turnState } from './turns';

/** See `deriveSessionStatus` in index.ts for the contract. */
export function sessionStatus(input: StatusInput): SessionStatusResult {
  const { events } = input;
  const last = events[events.length - 1];
  if (last === undefined) return { status: input.current, endReason: null, midTurn: false };
  const { midTurn } = turnState(events);
  if (last.kind === 'session.end')
    return { status: 'finished', endReason: last.data.reason, midTurn };
  const idle = input.now - input.lastActivityAt;
  if (midTurn && idle >= (input.interruptAfterMs ?? TIMING.interruptAfterMs)) {
    return { status: 'interrupted', endReason: null, midTurn };
  }
  if (!midTurn && idle >= (input.abandonAfterMs ?? TIMING.abandonAfterMs)) {
    return { status: 'finished', endReason: 'no_session_end', midTurn };
  }
  return { status: 'active', endReason: null, midTurn };
}

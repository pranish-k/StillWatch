/**
 * Event queries. Events come back in display order: `order_ts`, then `seq`.
 */
import type { EventFacts, NormalizedEvent, Redaction, StoredEvent } from '@stillwatch/schema';
import type { Connection } from './connection';
import { clampLimit, decodeCursor, encodeCursor } from './cursor';
import { json, num, text, type Row } from './rows';

const EVENT_COLUMNS = 'seq, order_ts, event, facts, redactions, hash';
const EVENT_CURSOR = 'events';
/** Largest page `listEvents` returns. */
export const MAX_EVENT_PAGE = 500;
const DEFAULT_EVENT_PAGE = 200;

/** Builds a `StoredEvent` from an events row. */
export function rowToEvent(row: Row): StoredEvent {
  const event = json<NormalizedEvent>(row, 'event');
  return {
    ...event,
    seq: num(row, 'seq'),
    orderTs: num(row, 'order_ts'),
    facts: json<EventFacts>(row, 'facts'),
    redactions: json<Redaction[]>(row, 'redactions'),
    hash: text(row, 'hash'),
  };
}

/** All events of a session in display order. */
export function getSessionEvents(conn: Connection, sessionId: string): StoredEvent[] {
  return conn
    .all(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE session_id = ? ORDER BY order_ts, seq`,
      sessionId,
    )
    .map(rowToEvent);
}

/** One page of a session's events in display order. */
export function listEvents(
  conn: Connection,
  sessionId: string,
  options: { cursor: string | null; limit: number },
): { events: StoredEvent[]; nextCursor: string | null } {
  const limit = clampLimit(options.limit, DEFAULT_EVENT_PAGE, MAX_EVENT_PAGE);
  let rows: Row[];
  if (options.cursor === null) {
    rows = conn.all(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE session_id = ? ORDER BY order_ts, seq LIMIT ?`,
      sessionId,
      limit + 1,
    );
  } else {
    const [orderTs, seq] = decodeCursor(options.cursor, EVENT_CURSOR, ['number', 'number']);
    rows = conn.all(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE session_id = ? AND (order_ts, seq) > (?, ?)
       ORDER BY order_ts, seq LIMIT ?`,
      sessionId,
      orderTs ?? 0,
      seq ?? 0,
      limit + 1,
    );
  }
  const events = rows.slice(0, limit).map(rowToEvent);
  const last = events[events.length - 1];
  const nextCursor =
    rows.length > limit && last !== undefined
      ? encodeCursor(EVENT_CURSOR, [last.orderTs, last.seq])
      : null;
  return { events, nextCursor };
}

/** One event by id, or null. */
export function getEvent(conn: Connection, id: string): StoredEvent | null {
  const row = conn.get(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`, id);
  return row === null ? null : rowToEvent(row);
}

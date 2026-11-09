/**
 * Deletion, retention, chain verification, snapshots, gaps, and counts.
 */
import { statSync } from 'node:fs';
import type { CaptureGap, JsonObject, SessionSnapshot } from '@stillwatch/schema';
import { chainHash, chainSeed } from './chain';
import type { Connection } from './connection';
import { json, num, numOrNull, text, textOrNull } from './rows';
import type { ChainVerification } from './index';

/** Stores (or replaces) a session snapshot. Throws for an unknown session. */
export function saveSnapshot(conn: Connection, snapshot: SessionSnapshot): void {
  if (conn.get('SELECT 1 AS x FROM sessions WHERE id = ?', snapshot.sessionId) === null) {
    throw new Error(`storage: cannot save a snapshot for unknown session ${snapshot.sessionId}`);
  }
  conn.run(
    `INSERT INTO snapshots (session_id, kind, taken_at, snapshot) VALUES (?, ?, ?, ?)
     ON CONFLICT (session_id, kind) DO UPDATE SET taken_at = excluded.taken_at, snapshot = excluded.snapshot`,
    snapshot.sessionId,
    snapshot.kind,
    snapshot.takenAt,
    JSON.stringify(snapshot),
  );
}

/** A stored snapshot, or null. */
export function getSnapshot(
  conn: Connection,
  sessionId: string,
  kind: 'start' | 'end',
): SessionSnapshot | null {
  const row = conn.get(
    'SELECT snapshot FROM snapshots WHERE session_id = ? AND kind = ?',
    sessionId,
    kind,
  );
  return row === null ? null : json<SessionSnapshot>(row, 'snapshot');
}

/** Records a capture gap. Idempotent by gap id. */
export function addGap(conn: Connection, gap: CaptureGap): void {
  conn.run(
    `INSERT OR REPLACE INTO gaps (id, session_id, source, from_analysis, severity, started_at, ended_at, reason, created_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    gap.id,
    gap.sessionId,
    gap.source,
    gap.severity,
    gap.startedAt,
    gap.endedAt,
    gap.reason,
    gap.createdAt,
  );
}

/** Deletes one session and everything that belongs to it, including links in both directions. */
export function deleteSession(conn: Connection, id: string): boolean {
  return conn.tx(() => {
    conn.run('DELETE FROM gaps WHERE session_id = ?', id);
    const deleted = conn.run('DELETE FROM sessions WHERE id = ?', id).changes > 0;
    deleteOrphanProjects(conn);
    return deleted;
  });
}

/**
 * Deletes sessions whose lastEventAt is before `cutoff`, gaps older than the
 * cutoff that no stored session owns, and unused projects. Then returns free
 * pages to the file system.
 */
export function deleteSessionsBefore(conn: Connection, cutoff: number): number {
  const count = conn.tx(() => {
    conn.run(
      `DELETE FROM gaps WHERE session_id IN (SELECT id FROM sessions WHERE last_event_at < ?)`,
      cutoff,
    );
    const deleted = conn.run('DELETE FROM sessions WHERE last_event_at < ?', cutoff).changes;
    conn.run(
      `DELETE FROM gaps WHERE created_at < ?
       AND (session_id IS NULL OR session_id NOT IN (SELECT id FROM sessions))`,
      cutoff,
    );
    deleteOrphanProjects(conn);
    return deleted;
  });
  vacuum(conn);
  return count;
}

/** Deletes all sessions, events, gaps, and projects. Keeps the schema and meta rows. */
export function deleteAll(conn: Connection): void {
  conn.tx(() => {
    conn.run('DELETE FROM gaps');
    conn.run('DELETE FROM sessions');
    conn.run('DELETE FROM projects');
  });
  vacuum(conn);
}

function deleteOrphanProjects(conn: Connection): void {
  conn.run(
    'DELETE FROM projects WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.project_id = projects.id)',
  );
}

function vacuum(conn: Connection): void {
  conn.exec('PRAGMA incremental_vacuum');
  conn.restrictFiles();
}

/** Recomputes the hash chain of one session or of every session. */
export function verifyChain(conn: Connection, sessionId?: string): ChainVerification[] {
  const sessions =
    sessionId === undefined
      ? conn.all('SELECT id, chain_head, event_count FROM sessions ORDER BY started_at, id')
      : conn.all('SELECT id, chain_head, event_count FROM sessions WHERE id = ?', sessionId);
  return sessions.map((row) =>
    verifySession(conn, text(row, 'id'), textOrNull(row, 'chain_head'), num(row, 'event_count')),
  );
}

function verifySession(
  conn: Connection,
  sessionId: string,
  head: string | null,
  expectedCount: number,
): ChainVerification {
  let prev = chainSeed(sessionId);
  let events = 0;
  const fail = (seq: number | null, reason: string): ChainVerification => ({
    sessionId,
    events,
    ok: false,
    firstBadSeq: seq,
    reason,
  });
  for (const row of conn.iterate(
    `SELECT seq, id, source_id, kind, ts, event, facts, redactions, prev_hash, hash
     FROM events WHERE session_id = ? ORDER BY seq`,
    sessionId,
  )) {
    events++;
    const seq = num(row, 'seq');
    let payload: JsonObject;
    try {
      payload = {
        ...json<JsonObject>(row, 'event'),
        facts: json<JsonObject>(row, 'facts'),
        redactions: json<JsonObject>(row, 'redactions'),
      };
    } catch {
      return fail(seq, 'stored event is not valid JSON');
    }
    if (
      payload.id !== text(row, 'id') ||
      payload.sourceId !== text(row, 'source_id') ||
      payload.sessionId !== sessionId ||
      payload.kind !== text(row, 'kind') ||
      payload.ts !== numOrNull(row, 'ts')
    ) {
      return fail(seq, 'indexed columns do not match the stored event');
    }
    if (text(row, 'prev_hash') !== prev) {
      return fail(seq, 'previous hash does not match (an earlier event was changed or removed)');
    }
    let hash: string;
    try {
      hash = chainHash(prev, payload);
    } catch {
      return fail(seq, 'stored event cannot be hashed');
    }
    if (hash !== text(row, 'hash')) return fail(seq, 'event content does not match its hash');
    prev = hash;
  }
  if (events !== expectedCount) {
    return fail(null, `session records ${expectedCount} events but ${events} are stored`);
  }
  if (events > 0 && head !== prev) {
    return fail(null, 'chain head does not match the newest event (events were removed)');
  }
  return { sessionId, events, ok: true, firstBadSeq: null, reason: null };
}

/** Session and event counts and the database size on disk (main file plus WAL). */
export function counts(conn: Connection): { sessions: number; events: number; sizeBytes: number } {
  const row = conn.get(
    'SELECT (SELECT count(*) FROM sessions) AS sessions, (SELECT count(*) FROM events) AS events',
  );
  let sizeBytes = 0;
  for (const file of [conn.path, `${conn.path}-wal`]) {
    try {
      sizeBytes += statSync(file).size;
    } catch {
      // A missing WAL file counts as zero.
    }
  }
  return {
    sessions: row === null ? 0 : num(row, 'sessions'),
    events: row === null ? 0 : num(row, 'events'),
    sizeBytes,
  };
}

/** Newest lastEventAt over all sessions, or null when there are none. */
export function lastEventAt(conn: Connection): number | null {
  const row = conn.get('SELECT max(last_event_at) AS t FROM sessions');
  return row === null ? null : numOrNull(row, 't');
}

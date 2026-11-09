/**
 * Analysis storage: saving results, the pending queue, and prior context
 * from other sessions.
 */
import {
  pathKey,
  riskRank,
  severityRank,
  type AnalysisResult,
  type Finding,
  type PathClass,
  type PriorContext,
  type SessionStatus,
} from '@stillwatch/schema';
import type { Connection } from './connection';
import { flag, num, numOrNull, text, textOrNull } from './rows';
import { sessionFindings } from './sessions';
import type { AnalysisMeta } from './index';

/** Path classes whose writes can carry instructions into a later session. */
const NOTE_CLASSES: ReadonlySet<PathClass> = new Set<PathClass>(['memory_note', 'agent_config']);
const WRITE_ATTRIBUTIONS = ['tool', 'shell'] as const;

/**
 * Replaces all derived rows for the session and updates its columns in one
 * transaction. A no-op when the session no longer exists (deleted while it was
 * being analyzed). `meta.status` applies only when the analysis covers every
 * stored event; otherwise the status kept by ingest is newer.
 */
export function saveAnalysis(
  conn: Connection,
  sessionId: string,
  result: AnalysisResult,
  meta: AnalysisMeta,
  now: () => number,
): void {
  conn.tx(() => {
    const session = conn.get(
      'SELECT max_seq, last_event_at, status, end_reason, ended_at FROM sessions WHERE id = ?',
      sessionId,
    );
    if (session === null) return;
    const lastEventAt = num(session, 'last_event_at');
    const eventTs = eventTimeLookup(conn, sessionId);
    const writeTime = (eventIds: string[]): number => {
      let at: number | null = null;
      for (const id of eventIds) {
        const ts = eventTs(id);
        if (ts !== null && (at === null || ts > at)) at = ts;
      }
      return at ?? lastEventAt;
    };

    conn.run('DELETE FROM findings WHERE session_id = ?', sessionId);
    conn.run('DELETE FROM file_changes WHERE session_id = ?', sessionId);
    conn.run('DELETE FROM artifacts WHERE session_id = ?', sessionId);
    conn.run('DELETE FROM domains WHERE session_id = ?', sessionId);
    conn.run('DELETE FROM links WHERE target_session_id = ?', sessionId);
    conn.run('DELETE FROM gaps WHERE session_id = ? AND from_analysis = 1', sessionId);

    result.findings.forEach((finding, ord) => {
      conn.run(
        `INSERT OR REPLACE INTO findings (session_id, id, ord, rule_id, severity, severity_rank, title, ts, finding)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sessionId,
        finding.id,
        ord,
        finding.ruleId,
        finding.severity,
        severityRank(finding.severity),
        finding.title,
        finding.ts,
        JSON.stringify(finding),
      );
    });
    result.fileChanges.forEach((change, ord) => {
      const isNote = change.classes.some((c) => NOTE_CLASSES.has(c));
      conn.run(
        `INSERT INTO file_changes (session_id, ord, path, path_key, attribution, is_note, at, change)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        sessionId,
        ord,
        change.path,
        pathKey(change.path),
        change.attribution,
        flag(isNote),
        isNote ? writeTime(change.eventIds) : lastEventAt,
        JSON.stringify(change),
      );
    });
    result.artifacts.forEach((artifact, ord) => {
      conn.run(
        `INSERT OR REPLACE INTO artifacts (session_id, id, ord, kind, path, path_key, at, artifact)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        sessionId,
        artifact.id,
        ord,
        artifact.kind,
        artifact.path,
        pathKey(artifact.path),
        writeTime(artifact.eventIds),
        JSON.stringify(artifact),
      );
    });
    result.domains.forEach((domain, ord) => {
      conn.run(
        'INSERT OR REPLACE INTO domains (session_id, domain, ord, record) VALUES (?, ?, ?, ?)',
        sessionId,
        domain.domain,
        ord,
        JSON.stringify(domain),
      );
    });
    let linkOrd = 0;
    for (const link of result.links) {
      // Links from sessions that are gone (retention) or to itself are dropped.
      if (link.sourceSessionId === sessionId) continue;
      const inserted = conn.run(
        `INSERT INTO links (target_session_id, ord, source_session_id, path, kind, event_id, at)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ?)`,
        sessionId,
        linkOrd,
        link.sourceSessionId,
        link.path,
        link.kind,
        link.eventId,
        link.at,
        link.sourceSessionId,
      );
      linkOrd += inserted.changes;
    }
    for (const gap of result.gaps) {
      conn.run(
        `INSERT OR REPLACE INTO gaps (id, session_id, source, from_analysis, severity, started_at, ended_at, reason, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        gap.id,
        sessionId,
        gap.source,
        gap.severity,
        gap.startedAt,
        gap.endedAt,
        gap.reason,
        gap.createdAt,
      );
    }

    // A stale analysis (new events arrived meanwhile) keeps the status set by ingest.
    const complete = meta.analyzedThroughSeq >= num(session, 'max_seq');
    let status = text(session, 'status');
    let endReason = textOrNull(session, 'end_reason');
    let endedAt = numOrNull(session, 'ended_at');
    if (complete) {
      status = meta.status;
      endReason = meta.endReason;
      if (meta.status === 'finished') endedAt ??= lastEventAt;
      else if (meta.status === 'active') endedAt = null;
    }
    conn.run(
      `UPDATE sessions SET risk = ?, risk_rank = ?, risk_reasons = ?, summary = ?,
         finding_count = ?, file_change_count = ?, analyzed_at = ?, analysis_version = ?,
         analyzed_through_seq = ?, stats = ?, unfinished = ?, sensitive_access = ?,
         last_assistant_message = ?, status = ?, end_reason = ?, ended_at = ?
       WHERE id = ?`,
      result.risk,
      riskRank(result.risk),
      JSON.stringify(result.riskReasons),
      meta.summary,
      result.findings.length,
      result.fileChanges.length,
      now(),
      meta.analysisVersion,
      meta.analyzedThroughSeq,
      JSON.stringify(result.stats),
      JSON.stringify(result.unfinished),
      JSON.stringify(result.sensitiveAccess),
      result.lastAssistantMessage,
      status,
      endReason,
      endedAt,
      sessionId,
    );
  });
}

function eventTimeLookup(conn: Connection, sessionId: string): (eventId: string) => number | null {
  return (eventId) => {
    const row = conn.get(
      'SELECT ts FROM events WHERE id = ? AND session_id = ?',
      eventId,
      sessionId,
    );
    return row === null ? null : num(row, 'ts');
  };
}

/** Sets a session's status, end reason, and end time. */
export function setSessionStatus(
  conn: Connection,
  sessionId: string,
  status: SessionStatus,
  endReason: string | null,
  endedAt: number | null,
): void {
  conn.run(
    'UPDATE sessions SET status = ?, end_reason = ?, ended_at = ? WHERE id = ?',
    status,
    endReason,
    endedAt,
    sessionId,
  );
}

/** Marks a session for re-analysis of all its events. */
export function markForAnalysis(conn: Connection, sessionId: string): void {
  conn.run('UPDATE sessions SET analyzed_through_seq = 0 WHERE id = ?', sessionId);
}

/** Sessions with events newer than their last analysis, oldest activity first. */
export function pendingAnalysis(conn: Connection): { sessionId: string; maxSeq: number }[] {
  return conn
    .all(
      `SELECT id, max_seq FROM sessions WHERE max_seq > analyzed_through_seq
       ORDER BY last_event_at, id`,
    )
    .map((row) => ({ sessionId: text(row, 'id'), maxSeq: num(row, 'max_seq') }));
}

/** Event id to the ids of findings that cite it, for one session. */
export function findingIdsByEvent(conn: Connection, sessionId: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const findings: Finding[] = sessionFindings(conn, sessionId);
  for (const finding of findings) {
    for (const eventId of finding.evidence.eventIds) {
      const list = (out[eventId] ??= []);
      if (!list.includes(finding.id)) list.push(finding.id);
    }
  }
  return out;
}

/** Context from other sessions, see `PriorContext` in `@stillwatch/schema`. */
export function getPriorContext(conn: Connection, sessionId: string): PriorContext {
  const empty: PriorContext = { knownDomains: [], noteWriters: {}, overlapping: [] };
  const session = conn.get(
    'SELECT started_at, last_event_at FROM sessions WHERE id = ?',
    sessionId,
  );
  if (session === null) return empty;
  const startedAt = num(session, 'started_at');
  const lastEventAt = num(session, 'last_event_at');

  const knownDomains = conn
    .all(
      `SELECT DISTINCT d.domain FROM domains d JOIN sessions s ON s.id = d.session_id
       WHERE s.started_at < ? AND s.id != ? ORDER BY d.domain`,
      startedAt,
      sessionId,
    )
    .map((row) => text(row, 'domain'));

  // Latest write per (path key, session), then oldest first per path key.
  const latest = new Map<string, Map<string, number>>();
  const noteRows = conn.all(
    `SELECT path_key, session_id, at FROM artifacts
       WHERE kind IN ('memory_note', 'agent_config') AND at <= ? AND session_id != ?
     UNION ALL
     SELECT path_key, session_id, at FROM file_changes
       WHERE is_note = 1 AND at <= ? AND session_id != ?`,
    lastEventAt,
    sessionId,
    lastEventAt,
    sessionId,
  );
  for (const row of noteRows) {
    const key = text(row, 'path_key');
    const writer = text(row, 'session_id');
    const at = num(row, 'at');
    let bySession = latest.get(key);
    if (bySession === undefined) {
      bySession = new Map();
      latest.set(key, bySession);
    }
    const previous = bySession.get(writer);
    if (previous === undefined || at > previous) bySession.set(writer, at);
  }
  const noteWriters: PriorContext['noteWriters'] = {};
  for (const key of [...latest.keys()].sort()) {
    const writers = [...(latest.get(key) ?? new Map<string, number>()).entries()]
      .map(([writer, at]) => ({ sessionId: writer, at }))
      .sort((a, b) => a.at - b.at || (a.sessionId < b.sessionId ? -1 : 1));
    noteWriters[key] = writers;
  }

  const overlapping: PriorContext['overlapping'] = conn
    .all(
      `SELECT id, started_at, last_event_at FROM sessions
       WHERE id != ? AND started_at <= ? AND last_event_at >= ?
       ORDER BY started_at, id`,
      sessionId,
      lastEventAt,
      startedAt,
    )
    .map((row) => {
      const id = text(row, 'id');
      const writes = conn
        .all(
          `SELECT path FROM file_changes WHERE session_id = ?
           AND attribution IN (SELECT value FROM json_each(?)) ORDER BY ord`,
          id,
          JSON.stringify(WRITE_ATTRIBUTIONS),
        )
        .map((w) => text(w, 'path'));
      return {
        sessionId: id,
        startedAt: num(row, 'started_at'),
        lastEventAt: numOrNull(row, 'last_event_at') ?? num(row, 'started_at'),
        writes: [...new Set(writes)],
      };
    });

  return { knownDomains, noteWriters, overlapping };
}

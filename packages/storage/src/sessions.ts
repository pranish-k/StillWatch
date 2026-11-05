/**
 * Session queries: single records, the review list, and the detail view.
 */
import type {
  AgentKind,
  AgentRecord,
  Artifact,
  CaptureGap,
  DomainRecord,
  FileChange,
  Finding,
  GapSource,
  RiskLevel,
  SensitiveAccess,
  SessionDetail,
  SessionLinkView,
  SessionListQuery,
  SessionListResponse,
  SessionRecord,
  SessionStats,
  SessionStatus,
  SessionSummary,
  Severity,
  UnfinishedItem,
} from '@stillwatch/schema';
import type { SQLInputValue } from 'node:sqlite';
import type { Connection } from './connection';
import { clampLimit, decodeCursor, encodeCursor } from './cursor';
import { json, jsonOrNull, num, numOrNull, text, textOrNull, type Row } from './rows';

/** Largest page `listSessions` returns. */
export const MAX_SESSION_PAGE = 200;
const DEFAULT_SESSION_PAGE = 50;
const TOP_FINDINGS = 3;

/** Builds a `SessionRecord` from a sessions row. */
export function rowToSession(row: Row): SessionRecord {
  return {
    id: text(row, 'id'),
    agent: text(row, 'agent') as AgentKind,
    projectId: textOrNull(row, 'project_id'),
    projectRoot: textOrNull(row, 'project_root'),
    projectName: textOrNull(row, 'project_name'),
    cwd: textOrNull(row, 'cwd'),
    transcriptPath: textOrNull(row, 'transcript_path'),
    title: textOrNull(row, 'title'),
    startedAt: num(row, 'started_at'),
    endedAt: numOrNull(row, 'ended_at'),
    lastEventAt: num(row, 'last_event_at'),
    status: text(row, 'status') as SessionStatus,
    endReason: textOrNull(row, 'end_reason'),
    risk: text(row, 'risk') as RiskLevel,
    riskReasons: json<string[]>(row, 'risk_reasons'),
    model: textOrNull(row, 'model'),
    permissionMode: textOrNull(row, 'permission_mode'),
    summary: textOrNull(row, 'summary'),
    eventCount: num(row, 'event_count'),
    findingCount: num(row, 'finding_count'),
    fileChangeCount: num(row, 'file_change_count'),
    subagentCount: num(row, 'subagent_count'),
    analyzedAt: numOrNull(row, 'analyzed_at'),
    analysisVersion: numOrNull(row, 'analysis_version'),
    chainHead: textOrNull(row, 'chain_head'),
  };
}

/** Builds a `CaptureGap` from a gaps row. */
export function rowToGap(row: Row): CaptureGap {
  return {
    id: text(row, 'id'),
    sessionId: textOrNull(row, 'session_id'),
    source: text(row, 'source') as GapSource,
    severity: text(row, 'severity') as CaptureGap['severity'],
    startedAt: numOrNull(row, 'started_at'),
    endedAt: numOrNull(row, 'ended_at'),
    reason: text(row, 'reason'),
    createdAt: num(row, 'created_at'),
  };
}

/** One session, or null. */
export function getSession(conn: Connection, id: string): SessionRecord | null {
  const row = conn.get('SELECT * FROM sessions WHERE id = ?', id);
  return row === null ? null : rowToSession(row);
}

/** Sessions with a status, newest activity first. */
export function sessionsWithStatus(conn: Connection, status: SessionStatus): SessionRecord[] {
  return conn
    .all('SELECT * FROM sessions WHERE status = ? ORDER BY last_event_at DESC, id DESC', status)
    .map(rowToSession);
}

/**
 * Gaps for a session (or global gaps for `null`), oldest first.
 * `excludeSource: 'analysis'` also excludes every gap stored by `saveAnalysis`.
 */
export function getGaps(
  conn: Connection,
  sessionId: string | null,
  excludeSource: GapSource | null,
): CaptureGap[] {
  const exclude = excludeSource ?? '';
  const rows =
    sessionId === null
      ? conn.all(
          `SELECT * FROM gaps WHERE session_id IS NULL AND source != ?
           AND NOT (? = 'analysis' AND from_analysis = 1) ORDER BY created_at, rowid`,
          exclude,
          exclude,
        )
      : conn.all(
          `SELECT * FROM gaps WHERE session_id = ? AND source != ?
           AND NOT (? = 'analysis' AND from_analysis = 1) ORDER BY created_at, rowid`,
          sessionId,
          exclude,
          exclude,
        );
  return rows.map(rowToGap);
}

/** Escapes LIKE wildcards with a backslash. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const SUMMARY_COLUMNS = `s.id, s.agent, s.title, s.project_id, s.project_name, s.project_root,
  s.started_at, s.ended_at, s.last_event_at, s.status, s.risk, s.risk_rank, s.risk_reasons, s.summary,
  s.event_count, s.finding_count, s.file_change_count, s.subagent_count,
  (SELECT count(*) FROM gaps g WHERE g.session_id = s.id) AS gap_count`;

/** The session list with filters, review or recent order, and keyset pagination. */
export function listSessions(conn: Connection, query: SessionListQuery): SessionListResponse {
  const limit = clampLimit(query.limit, DEFAULT_SESSION_PAGE, MAX_SESSION_PAGE);
  const review = query.sort !== 'recent';
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  if (query.risk !== null && query.risk.length > 0) {
    where.push('s.risk IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(query.risk));
  }
  if (query.status !== null && query.status.length > 0) {
    where.push('s.status IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(query.status));
  }
  if (query.projectId !== null) {
    where.push('s.project_id = ?');
    params.push(query.projectId);
  }
  const q = query.q?.trim() ?? '';
  if (q !== '') {
    const pattern = likePattern(q);
    where.push(
      `(s.title LIKE ? ESCAPE '\\' OR s.summary LIKE ? ESCAPE '\\' OR s.project_name LIKE ? ESCAPE '\\')`,
    );
    params.push(pattern, pattern, pattern);
  }

  const filter = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = conn.get(`SELECT count(*) AS n FROM sessions s ${filter}`, ...params);
  const total = totalRow === null ? 0 : num(totalRow, 'n');

  const tag = review ? 'sessions.review' : 'sessions.recent';
  const pageWhere = [...where];
  const pageParams = [...params];
  if (query.cursor !== null) {
    if (review) {
      const [rank, last, id] = decodeCursor(query.cursor, tag, ['number', 'number', 'string']);
      pageWhere.push('(s.risk_rank, s.last_event_at, s.id) < (?, ?, ?)');
      pageParams.push(rank ?? 0, last ?? 0, id ?? '');
    } else {
      const [last, id] = decodeCursor(query.cursor, tag, ['number', 'string']);
      pageWhere.push('(s.last_event_at, s.id) < (?, ?)');
      pageParams.push(last ?? 0, id ?? '');
    }
  }
  const order = review
    ? 'ORDER BY s.risk_rank DESC, s.last_event_at DESC, s.id DESC'
    : 'ORDER BY s.last_event_at DESC, s.id DESC';
  const pageFilter = pageWhere.length > 0 ? `WHERE ${pageWhere.join(' AND ')}` : '';
  const rows = conn.all(
    `SELECT ${SUMMARY_COLUMNS} FROM sessions s ${pageFilter} ${order} LIMIT ?`,
    ...pageParams,
    limit + 1,
  );
  const page = rows.slice(0, limit);
  const top = topFindings(
    conn,
    page.map((row) => text(row, 'id')),
  );
  const sessions = page.map((row) => rowToSummary(row, top.get(text(row, 'id')) ?? []));

  let nextCursor: string | null = null;
  const last = page[page.length - 1];
  if (rows.length > limit && last !== undefined) {
    nextCursor = review
      ? encodeCursor(tag, [num(last, 'risk_rank'), num(last, 'last_event_at'), text(last, 'id')])
      : encodeCursor(tag, [num(last, 'last_event_at'), text(last, 'id')]);
  }
  return { sessions, nextCursor, total };
}

function rowToSummary(row: Row, top: SessionSummary['topFindings']): SessionSummary {
  return {
    id: text(row, 'id'),
    agent: text(row, 'agent') as AgentKind,
    title: textOrNull(row, 'title'),
    projectId: textOrNull(row, 'project_id'),
    projectName: textOrNull(row, 'project_name'),
    projectRoot: textOrNull(row, 'project_root'),
    startedAt: num(row, 'started_at'),
    endedAt: numOrNull(row, 'ended_at'),
    lastEventAt: num(row, 'last_event_at'),
    status: text(row, 'status') as SessionStatus,
    risk: text(row, 'risk') as RiskLevel,
    riskReasons: json<string[]>(row, 'risk_reasons'),
    summary: textOrNull(row, 'summary'),
    eventCount: num(row, 'event_count'),
    findingCount: num(row, 'finding_count'),
    fileChangeCount: num(row, 'file_change_count'),
    subagentCount: num(row, 'subagent_count'),
    topFindings: top,
    gapCount: num(row, 'gap_count'),
  };
}

function topFindings(
  conn: Connection,
  sessionIds: string[],
): Map<string, SessionSummary['topFindings']> {
  const out = new Map<string, SessionSummary['topFindings']>();
  if (sessionIds.length === 0) return out;
  const rows = conn.all(
    `SELECT session_id, severity, title FROM findings
     WHERE session_id IN (SELECT value FROM json_each(?))
     ORDER BY session_id, severity_rank DESC, ts, ord`,
    JSON.stringify(sessionIds),
  );
  for (const row of rows) {
    const id = text(row, 'session_id');
    let list = out.get(id);
    if (list === undefined) {
      list = [];
      out.set(id, list);
    }
    if (list.length < TOP_FINDINGS) {
      list.push({ severity: text(row, 'severity') as Severity, title: text(row, 'title') });
    }
  }
  return out;
}

/** Findings of a session, highest severity first, then oldest. */
export function sessionFindings(conn: Connection, sessionId: string): Finding[] {
  return conn
    .all(
      'SELECT finding FROM findings WHERE session_id = ? ORDER BY severity_rank DESC, ts, ord',
      sessionId,
    )
    .map((row) => json<Finding>(row, 'finding'));
}

/** Everything about one session for the dashboard and the report builder. */
export function getSessionDetail(conn: Connection, id: string): SessionDetail | null {
  const row = conn.get('SELECT * FROM sessions WHERE id = ?', id);
  if (row === null) return null;
  const session = rowToSession(row);

  const agents: AgentRecord[] = conn
    .all(
      `SELECT * FROM agents WHERE session_id = ?
       ORDER BY agent_id = 'main' DESC, started_at IS NULL, started_at, rowid`,
      id,
    )
    .map((a) => ({
      sessionId: id,
      agentId: text(a, 'agent_id'),
      agentType: textOrNull(a, 'agent_type'),
      startedAt: numOrNull(a, 'started_at'),
      stoppedAt: numOrNull(a, 'stopped_at'),
      transcriptPath: textOrNull(a, 'transcript_path'),
      lastMessage: textOrNull(a, 'last_message'),
      eventCount: num(a, 'event_count'),
    }));

  const fileChanges = conn
    .all('SELECT change FROM file_changes WHERE session_id = ? ORDER BY ord', id)
    .map((r) => json<FileChange>(r, 'change'));
  const artifacts = conn
    .all('SELECT artifact FROM artifacts WHERE session_id = ? ORDER BY ord', id)
    .map((r) => json<Artifact>(r, 'artifact'));
  const domains = conn
    .all('SELECT record FROM domains WHERE session_id = ? ORDER BY ord', id)
    .map((r) => json<DomainRecord>(r, 'record'));

  const links: SessionLinkView[] = conn
    .all(
      `SELECT l.source_session_id, l.target_session_id, l.path, l.kind, l.event_id, l.at,
         CASE WHEN l.target_session_id = ?1 THEN 'incoming' ELSE 'outgoing' END AS direction,
         o.title AS other_title
       FROM links l
       LEFT JOIN sessions o ON o.id = CASE WHEN l.target_session_id = ?1
         THEN l.source_session_id ELSE l.target_session_id END
       WHERE l.target_session_id = ?1 OR l.source_session_id = ?1
       ORDER BY l.at, l.target_session_id, l.ord`,
      id,
    )
    .map((l) => ({
      sourceSessionId: text(l, 'source_session_id'),
      targetSessionId: text(l, 'target_session_id'),
      path: text(l, 'path'),
      kind: text(l, 'kind') as SessionLinkView['kind'],
      eventId: textOrNull(l, 'event_id'),
      at: num(l, 'at'),
      direction: text(l, 'direction') as SessionLinkView['direction'],
      otherSessionTitle: textOrNull(l, 'other_title'),
    }));

  return {
    session,
    agents,
    findings: sessionFindings(conn, id),
    fileChanges,
    artifacts,
    links,
    gaps: getGaps(conn, id, null),
    domains,
    unfinished: json<UnfinishedItem[]>(row, 'unfinished'),
    sensitiveAccess: json<SensitiveAccess[]>(row, 'sensitive_access'),
    stats: jsonOrNull<SessionStats>(row, 'stats'),
    lastAssistantMessage: textOrNull(row, 'last_assistant_message'),
  };
}

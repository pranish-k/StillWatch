/**
 * `insertEvents`: stores events, extends each session's hash chain, keeps
 * display order, and maintains session and agent rows, all in one transaction.
 */
import {
  LIMITS,
  MAIN_AGENT_ID,
  baseName,
  riskRank,
  toJsonValue,
  type EventFacts,
  type JsonObject,
  type NormalizedEvent,
  type Redaction,
  type SessionStatus,
} from '@stillwatch/schema';
import { chainHash, chainSeed, projectIdFor } from './chain';
import type { Connection } from './connection';
import { flag, num, numOrNull, text, textOrNull, type Row } from './rows';
import type { InsertEventInput, InsertResult } from './index';

/** Kinds that carry a tool result and must sort after their `tool.pre`. */
const RESULT_KINDS = ['tool.post', 'tool.failure', 'permission.denied'] as const;
const RESULT_KIND_SET: ReadonlySet<string> = new Set(RESULT_KINDS);
/** Minimum display gap between a tool call and its result, in milliseconds. */
const RESULT_GAP_MS = 0.001;
/** Risk of a session that has not been analyzed yet. */
const UNANALYZED_RISK = 'unknown';

type AgentState = {
  agentId: string;
  agentType: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
  transcriptPath: string | null;
  lastMessage: string | null;
  eventCount: number;
  dirty: boolean;
};

type SessionState = {
  id: string;
  projectId: string | null;
  projectRoot: string | null;
  projectName: string | null;
  cwd: string | null;
  cwdFromStart: boolean;
  transcriptPath: string | null;
  title: string | null;
  titleFromCustom: boolean;
  startedAt: number;
  endedAt: number | null;
  lastEventAt: number;
  status: SessionStatus;
  endReason: string | null;
  model: string | null;
  permissionMode: string | null;
  eventCount: number;
  maxSeq: number;
  chainHead: string;
  agents: Map<string, AgentState>;
};

const INSERT_EVENT = `INSERT INTO events (id, source_id, session_id, agent_id, prompt_id, kind,
  source_event, tool_name, tool_use_id, ts, order_ts, event, facts, redactions, prev_hash, hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (source_id) DO NOTHING`;

const RESULT_KIND_SQL = RESULT_KINDS.map((k) => `'${k}'`).join(', ');

/** Inserts events and maintains sessions. See the header of `index.ts` for the rules. */
export function insertEvents(
  conn: Connection,
  items: InsertEventInput[],
  now: () => number,
): InsertResult {
  if (items.length === 0) return { inserted: 0, duplicates: 0, sessionIds: [] };
  for (const item of items) validate(item.event);
  return conn.tx(() => {
    const sessions = new Map<string, SessionState>();
    let inserted = 0;
    let duplicates = 0;
    for (const item of items) {
      const state = sessionState(conn, sessions, item.event);
      if (insertOne(conn, state, item)) {
        inserted++;
        applyUpkeep(conn, state, item, now);
      } else {
        duplicates++;
      }
    }
    for (const state of sessions.values()) writeSession(conn, state);
    return { inserted, duplicates, sessionIds: [...sessions.keys()] };
  });
}

function validate(event: NormalizedEvent): void {
  if (typeof event.id !== 'string' || event.id === '') {
    throw new TypeError('storage: event id must be a non-empty string');
  }
  if (typeof event.sessionId !== 'string' || event.sessionId === '') {
    throw new TypeError(`storage: event ${event.id} has no session id`);
  }
  if (typeof event.sourceId !== 'string' || event.sourceId === '') {
    throw new TypeError(`storage: event ${event.id} has no source id`);
  }
  if (typeof event.ts !== 'number' || !Number.isFinite(event.ts)) {
    throw new TypeError(`storage: event ${event.id} has no finite ts`);
  }
}

/** Builds the chain payload as a clean JSON object (the exact value that is stored). */
function chainPayload(
  event: NormalizedEvent,
  facts: EventFacts,
  redactions: Redaction[],
): JsonObject {
  return toJsonValue({ ...event, facts, redactions }, LIMITS.maxJsonDepth + 4) as JsonObject;
}

/** Inserts one event. Returns false when its source id was already stored. */
function insertOne(conn: Connection, state: SessionState, item: InsertEventInput): boolean {
  const { event } = item;
  const useId = event.tool?.useId ?? null;
  let orderTs = event.ts;
  let resultsFloor: number | null = null;
  if (useId !== null) {
    if (event.kind === 'tool.pre') {
      const row = conn.get(
        `SELECT min(order_ts) AS o FROM events WHERE session_id = ? AND tool_use_id = ? AND kind IN (${RESULT_KIND_SQL})`,
        event.sessionId,
        useId,
      );
      const earliest = row === null ? null : numOrNull(row, 'o');
      if (earliest !== null && earliest < event.ts + RESULT_GAP_MS) {
        resultsFloor = event.ts + RESULT_GAP_MS;
      }
    } else if (RESULT_KIND_SET.has(event.kind)) {
      const row = conn.get(
        `SELECT max(order_ts) AS o FROM events WHERE session_id = ? AND tool_use_id = ? AND kind = 'tool.pre'`,
        event.sessionId,
        useId,
      );
      const call = row === null ? null : numOrNull(row, 'o');
      if (call !== null) orderTs = Math.max(event.ts, call + RESULT_GAP_MS);
    }
  }

  const payload = chainPayload(event, item.facts, item.redactions);
  const { facts, redactions, ...stored } = payload;
  const hash = chainHash(state.chainHead, payload);
  const result = conn.run(
    INSERT_EVENT,
    event.id,
    event.sourceId,
    event.sessionId,
    event.agentId,
    event.promptId,
    event.kind,
    event.sourceEvent,
    event.tool?.name ?? null,
    useId,
    event.ts,
    orderTs,
    JSON.stringify(stored),
    JSON.stringify(facts ?? null),
    JSON.stringify(redactions ?? null),
    state.chainHead,
    hash,
  );
  if (result.changes === 0) return false;

  if (resultsFloor !== null && useId !== null) {
    conn.run(
      `UPDATE events SET order_ts = ? WHERE session_id = ? AND tool_use_id = ? AND kind IN (${RESULT_KIND_SQL}) AND order_ts < ?`,
      resultsFloor,
      event.sessionId,
      useId,
      resultsFloor,
    );
  }
  state.chainHead = hash;
  state.maxSeq = result.lastInsertRowid;
  return true;
}

function sessionState(
  conn: Connection,
  sessions: Map<string, SessionState>,
  event: NormalizedEvent,
): SessionState {
  const cached = sessions.get(event.sessionId);
  if (cached !== undefined) return cached;
  const row = conn.get('SELECT * FROM sessions WHERE id = ?', event.sessionId);
  const state = row === null ? createSession(conn, event) : stateFromRow(row);
  for (const agent of conn.all('SELECT * FROM agents WHERE session_id = ?', state.id)) {
    const agentId = text(agent, 'agent_id');
    state.agents.set(agentId, {
      agentId,
      agentType: textOrNull(agent, 'agent_type'),
      startedAt: numOrNull(agent, 'started_at'),
      stoppedAt: numOrNull(agent, 'stopped_at'),
      transcriptPath: textOrNull(agent, 'transcript_path'),
      lastMessage: textOrNull(agent, 'last_message'),
      eventCount: num(agent, 'event_count'),
      dirty: false,
    });
  }
  sessions.set(state.id, state);
  return state;
}

function createSession(conn: Connection, event: NormalizedEvent): SessionState {
  conn.run(
    `INSERT INTO sessions (id, agent, started_at, last_event_at, status, risk, risk_rank)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    event.sessionId,
    event.agent,
    event.ts,
    event.ts,
    UNANALYZED_RISK,
    riskRank(UNANALYZED_RISK),
  );
  return {
    id: event.sessionId,
    projectId: null,
    projectRoot: null,
    projectName: null,
    cwd: null,
    cwdFromStart: false,
    transcriptPath: null,
    title: null,
    titleFromCustom: false,
    startedAt: event.ts,
    endedAt: null,
    lastEventAt: event.ts,
    status: 'active',
    endReason: null,
    model: null,
    permissionMode: null,
    eventCount: 0,
    maxSeq: 0,
    chainHead: chainSeed(event.sessionId),
    agents: new Map(),
  };
}

function stateFromRow(row: Row): SessionState {
  const id = text(row, 'id');
  return {
    id,
    projectId: textOrNull(row, 'project_id'),
    projectRoot: textOrNull(row, 'project_root'),
    projectName: textOrNull(row, 'project_name'),
    cwd: textOrNull(row, 'cwd'),
    cwdFromStart: num(row, 'cwd_from_start') !== 0,
    transcriptPath: textOrNull(row, 'transcript_path'),
    title: textOrNull(row, 'title'),
    titleFromCustom: num(row, 'title_from_custom') !== 0,
    startedAt: num(row, 'started_at'),
    endedAt: numOrNull(row, 'ended_at'),
    lastEventAt: num(row, 'last_event_at'),
    status: text(row, 'status') as SessionStatus,
    endReason: textOrNull(row, 'end_reason'),
    model: textOrNull(row, 'model'),
    permissionMode: textOrNull(row, 'permission_mode'),
    eventCount: num(row, 'event_count'),
    maxSeq: num(row, 'max_seq'),
    chainHead: textOrNull(row, 'chain_head') ?? chainSeed(id),
    agents: new Map(),
  };
}

function agentState(state: SessionState, agentId: string, ts: number): AgentState {
  let agent = state.agents.get(agentId);
  if (agent === undefined) {
    agent = {
      agentId,
      agentType: null,
      startedAt: ts,
      stoppedAt: null,
      transcriptPath: null,
      lastMessage: null,
      eventCount: 0,
      dirty: true,
    };
    state.agents.set(agentId, agent);
  }
  agent.dirty = true;
  return agent;
}

/** Cuts text to `max` characters without splitting a surrogate pair, ending with an ellipsis. */
export function capText(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max - 1;
  const code = value.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return `${value.slice(0, end)}…`;
}

/** The first non-empty line of a prompt, trimmed and capped, or null. */
export function titleFromPrompt(prompt: string): string | null {
  for (const line of prompt.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '') return capText(trimmed, LIMITS.titleMax);
  }
  return null;
}

function capMessage(message: string | null): string | null {
  return message === null ? null : capText(message, LIMITS.messageMax);
}

function applyUpkeep(
  conn: Connection,
  state: SessionState,
  item: InsertEventInput,
  now: () => number,
): void {
  const { event } = item;
  const ts = event.ts;

  // Status first, against the session's times before this event.
  if (event.kind === 'session.end') {
    state.status = 'finished';
    state.endedAt = ts;
    state.endReason = event.data.reason;
  } else if (state.status !== 'active' && ts > (state.endedAt ?? state.lastEventAt)) {
    state.status = 'active';
    state.endedAt = null;
    state.endReason = null;
    const main = state.agents.get(MAIN_AGENT_ID);
    if (main !== undefined) {
      main.stoppedAt = null;
      main.dirty = true;
    }
  }

  state.startedAt = Math.min(state.startedAt, ts);
  state.lastEventAt = Math.max(state.lastEventAt, ts);
  state.eventCount++;

  if (event.cwd !== null) {
    if (event.kind === 'session.start' && !state.cwdFromStart) {
      state.cwd = event.cwd;
      state.cwdFromStart = true;
    } else {
      state.cwd ??= event.cwd;
    }
  }
  if (event.transcriptPath !== null) state.transcriptPath = event.transcriptPath;
  if (event.permissionMode !== null) state.permissionMode = event.permissionMode;

  if (state.projectRoot === null && item.projectRoot !== null && item.projectRoot !== '') {
    state.projectRoot = item.projectRoot;
    state.projectId = projectIdFor(item.projectRoot);
    state.projectName = baseName(item.projectRoot);
    conn.run(
      'INSERT INTO projects (id, root, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
      state.projectId,
      state.projectRoot,
      state.projectName,
      now(),
    );
  }

  if (event.kind === 'session.start') {
    if (event.data.model !== null) state.model = event.data.model;
    setCustomTitle(state, event.data.sessionTitle);
  } else if (event.kind === 'model.switch') {
    if (event.data.toModel !== null) state.model = event.data.toModel;
  } else if (event.kind === 'prompt.submit') {
    setCustomTitle(state, event.data.sessionTitle);
    if (state.title === null && event.data.origin === 'user') {
      state.title = titleFromPrompt(event.data.prompt);
    }
  }

  // Agents.
  const owner = agentState(state, event.agentId ?? MAIN_AGENT_ID, ts);
  owner.eventCount++;
  owner.startedAt = owner.startedAt === null ? ts : Math.min(owner.startedAt, ts);
  owner.agentType ??= event.agentType;
  if (event.agentId === null && event.transcriptPath !== null) {
    owner.transcriptPath = event.transcriptPath;
  }
  if (event.kind === 'subagent.start') {
    const sub = agentState(state, event.data.subagentId, ts);
    sub.agentType ??= event.data.subagentType;
    sub.startedAt = sub.startedAt === null ? ts : Math.min(sub.startedAt, ts);
  } else if (event.kind === 'subagent.stop') {
    const sub = agentState(state, event.data.subagentId, ts);
    sub.agentType ??= event.data.subagentType;
    sub.stoppedAt = ts;
    if (event.data.transcriptPath !== null) sub.transcriptPath = event.data.transcriptPath;
    if (event.data.lastMessage !== null) sub.lastMessage = capMessage(event.data.lastMessage);
  } else if (event.kind === 'turn.stop' || event.kind === 'turn.failure') {
    if (event.data.lastMessage !== null) owner.lastMessage = capMessage(event.data.lastMessage);
  } else if (event.kind === 'session.end') {
    agentState(state, MAIN_AGENT_ID, ts).stoppedAt = ts;
  }
}

function setCustomTitle(state: SessionState, sessionTitle: string | null): void {
  if (sessionTitle === null || sessionTitle.trim() === '') return;
  state.title = capText(sessionTitle.trim(), LIMITS.titleMax);
  state.titleFromCustom = true;
}

function writeSession(conn: Connection, state: SessionState): void {
  for (const agent of state.agents.values()) {
    if (!agent.dirty) continue;
    conn.run(
      `INSERT INTO agents (session_id, agent_id, agent_type, started_at, stopped_at, transcript_path, last_message, event_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (session_id, agent_id) DO UPDATE SET agent_type = excluded.agent_type,
         started_at = excluded.started_at, stopped_at = excluded.stopped_at,
         transcript_path = excluded.transcript_path, last_message = excluded.last_message,
         event_count = excluded.event_count`,
      state.id,
      agent.agentId,
      agent.agentType,
      agent.startedAt,
      agent.stoppedAt,
      agent.transcriptPath,
      agent.lastMessage,
      agent.eventCount,
    );
    agent.dirty = false;
  }
  let subagents = 0;
  for (const id of state.agents.keys()) if (id !== MAIN_AGENT_ID) subagents++;
  conn.run(
    `UPDATE sessions SET project_id = ?, project_root = ?, project_name = ?, cwd = ?, cwd_from_start = ?,
       transcript_path = ?, title = ?, title_from_custom = ?, started_at = ?, ended_at = ?,
       last_event_at = ?, status = ?, end_reason = ?, model = ?, permission_mode = ?,
       event_count = ?, subagent_count = ?, max_seq = ?, chain_head = ?
     WHERE id = ?`,
    state.projectId,
    state.projectRoot,
    state.projectName,
    state.cwd,
    flag(state.cwdFromStart),
    state.transcriptPath,
    state.title,
    flag(state.titleFromCustom),
    state.startedAt,
    state.endedAt,
    state.lastEventAt,
    state.status,
    state.endReason,
    state.model,
    state.permissionMode,
    state.eventCount,
    subagents,
    state.maxSeq,
    state.chainHead,
    state.id,
  );
}

/**
 * Database migrations. Append-only: never edit a migration after it ships;
 * add a new one and bump `DB_SCHEMA_VERSION` in `index.ts`.
 *
 * Migration N brings the database from `user_version` N-1 to N.
 * JSON columns hold values written by this package only.
 */

export type Migration = { version: number; sql: string };

const V1 = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at REAL NOT NULL
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  project_root TEXT,
  project_name TEXT,
  cwd TEXT,
  cwd_from_start INTEGER NOT NULL DEFAULT 0,
  transcript_path TEXT,
  title TEXT,
  title_from_custom INTEGER NOT NULL DEFAULT 0,
  started_at REAL NOT NULL,
  ended_at REAL,
  last_event_at REAL NOT NULL,
  status TEXT NOT NULL,
  end_reason TEXT,
  risk TEXT NOT NULL,
  risk_rank INTEGER NOT NULL,
  risk_reasons TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  permission_mode TEXT,
  summary TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  finding_count INTEGER NOT NULL DEFAULT 0,
  file_change_count INTEGER NOT NULL DEFAULT 0,
  subagent_count INTEGER NOT NULL DEFAULT 0,
  analyzed_at REAL,
  analysis_version INTEGER,
  analyzed_through_seq INTEGER NOT NULL DEFAULT 0,
  max_seq INTEGER NOT NULL DEFAULT 0,
  chain_head TEXT,
  stats TEXT,
  unfinished TEXT NOT NULL DEFAULT '[]',
  sensitive_access TEXT NOT NULL DEFAULT '[]',
  last_assistant_message TEXT
) STRICT;
CREATE INDEX sessions_review ON sessions(risk_rank, last_event_at, id);
CREATE INDEX sessions_recent ON sessions(last_event_at, id);
CREATE INDEX sessions_project ON sessions(project_id, last_event_at);
CREATE INDEX sessions_status ON sessions(status, last_event_at);
CREATE INDEX sessions_started ON sessions(started_at);
CREATE INDEX sessions_pending ON sessions(id) WHERE max_seq > analyzed_through_seq;

CREATE TABLE agents (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  agent_type TEXT,
  started_at REAL,
  stopped_at REAL,
  transcript_path TEXT,
  last_message TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, agent_id)
) STRICT;

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id TEXT,
  prompt_id TEXT,
  kind TEXT NOT NULL,
  source_event TEXT NOT NULL,
  tool_name TEXT,
  tool_use_id TEXT,
  ts REAL NOT NULL,
  order_ts REAL NOT NULL,
  event TEXT NOT NULL,
  facts TEXT NOT NULL,
  redactions TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
) STRICT;
CREATE INDEX events_session_order ON events(session_id, order_ts, seq);
CREATE INDEX events_session_seq ON events(session_id, seq);
CREATE INDEX events_session_tool_use ON events(session_id, tool_use_id)
  WHERE tool_use_id IS NOT NULL;

CREATE TABLE snapshots (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  taken_at REAL NOT NULL,
  snapshot TEXT NOT NULL,
  PRIMARY KEY (session_id, kind)
) STRICT;

CREATE TABLE findings (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  severity_rank INTEGER NOT NULL,
  title TEXT NOT NULL,
  ts REAL NOT NULL,
  finding TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
) STRICT;
CREATE INDEX findings_session_rank ON findings(session_id, severity_rank DESC, ts, ord);

CREATE TABLE file_changes (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  path TEXT NOT NULL,
  path_key TEXT NOT NULL,
  attribution TEXT NOT NULL,
  is_note INTEGER NOT NULL,
  at REAL NOT NULL,
  change TEXT NOT NULL,
  PRIMARY KEY (session_id, ord)
) STRICT;
CREATE INDEX file_changes_notes ON file_changes(at) WHERE is_note = 1;

CREATE TABLE artifacts (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  path_key TEXT NOT NULL,
  at REAL NOT NULL,
  artifact TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
) STRICT;
CREATE INDEX artifacts_notes ON artifacts(at) WHERE kind IN ('memory_note', 'agent_config');

CREATE TABLE links (
  target_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  event_id TEXT,
  at REAL NOT NULL,
  PRIMARY KEY (target_session_id, ord)
) STRICT;
CREATE INDEX links_source ON links(source_session_id);

CREATE TABLE domains (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  ord INTEGER NOT NULL,
  record TEXT NOT NULL,
  PRIMARY KEY (session_id, domain)
) STRICT;

-- No foreign key: a gap can be recorded for a session before its first
-- event is stored. Session deletes and retention remove gaps explicitly.
CREATE TABLE gaps (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  source TEXT NOT NULL,
  from_analysis INTEGER NOT NULL DEFAULT 0,
  severity TEXT NOT NULL,
  started_at REAL,
  ended_at REAL,
  reason TEXT NOT NULL,
  created_at REAL NOT NULL
) STRICT;
CREATE INDEX gaps_session ON gaps(session_id, created_at);
CREATE INDEX gaps_created ON gaps(created_at);
`;

/** All migrations, in order. Append only. */
export const MIGRATIONS: readonly Migration[] = [{ version: 1, sql: V1 }];

/**
 * Local HTTP API types, shared by the collector (server) and the dashboard.
 *
 * Routes (all JSON unless noted, all under http://127.0.0.1:<port>):
 *   POST   /api/auth/exchange        AuthExchangeRequest -> AuthExchangeResponse (no token needed)
 *   GET    /api/status               StatusResponse
 *   GET    /api/sessions             SessionListResponse; query: see SessionListQuery
 *   GET    /api/sessions/:id         SessionDetailResponse
 *   GET    /api/sessions/:id/events  EventListResponse; query: cursor, limit (default 200, max 500)
 *   GET    /api/sessions/:id/report.md   text/markdown attachment
 *   POST   /api/sessions/:id/reanalyze   { ok: true }
 *   DELETE /api/sessions/:id         { ok: true }
 *   GET    /api/events/:id           EventView
 *
 * Every /api route except /api/auth/exchange requires `Authorization: Bearer <token>`.
 * Errors use `ApiErrorBody` with a matching HTTP status.
 */
import type { StoredEvent } from './analysis';
import type { RiskLevel, Severity } from './findings';
import type { SessionReport } from './report';
import type { CaptureGap, SessionDetail, SessionRecord, SessionStatus } from './session';

export type ApiErrorBody = { error: { code: string; message: string } };

/** Query string for GET /api/sessions. Lists are comma-separated. */
export type SessionListQuery = {
  risk: RiskLevel[] | null;
  status: SessionStatus[] | null;
  /** Case-insensitive text match on title, summary, and project. */
  q: string | null;
  projectId: string | null;
  /** `review` (default): risk high, medium, unknown, low, then newest. `recent`: newest first. */
  sort: 'review' | 'recent';
  /** Default 50, max 200. */
  limit: number;
  cursor: string | null;
};

export type SessionSummary = Pick<
  SessionRecord,
  | 'id'
  | 'agent'
  | 'title'
  | 'projectId'
  | 'projectName'
  | 'projectRoot'
  | 'startedAt'
  | 'endedAt'
  | 'lastEventAt'
  | 'status'
  | 'risk'
  | 'riskReasons'
  | 'summary'
  | 'eventCount'
  | 'findingCount'
  | 'fileChangeCount'
  | 'subagentCount'
> & {
  /** Up to three findings, highest severity first. */
  topFindings: { severity: Severity; title: string }[];
  /** Number of capture gaps recorded for the session. */
  gapCount: number;
};

export type SessionListResponse = {
  sessions: SessionSummary[];
  nextCursor: string | null;
  /** Total sessions matching the filters. */
  total: number;
};

export type SessionDetailResponse = SessionDetail & { report: SessionReport };

export type EventView = StoredEvent & {
  /** One-line human description, e.g. "Ran git status --short". */
  summary: string;
  findingIds: string[];
};

export type EventListResponse = { events: EventView[]; nextCursor: string | null };

export type HookInstallStatus = {
  installed: boolean;
  scope: 'user' | 'project' | 'local' | null;
  settingsPath: string | null;
  /** Hook events Stillwatch expects and found. */
  events: string[];
  /** Hook events Stillwatch expects but did not find in the settings file. */
  missing: string[];
  /**
   * Found hook events whose handler differs from what this version installs,
   * for example one written by an older version without `--ensure-collector`.
   */
  outdated: string[];
  hookScriptOk: boolean;
  claudeVersion: string | null;
  /** `null` when the Claude Code version could not be determined. */
  compatible: boolean | null;
};

export type StatusResponse = {
  version: string;
  collector: { pid: number; startedAt: number; port: number };
  spool: { pending: number; oldestAt: number | null; failedTotal: number };
  db: { path: string; sizeBytes: number; sessions: number; events: number };
  hooks: HookInstallStatus;
  lastEventAt: number | null;
  retentionDays: number;
  /** Gaps not tied to one session, newest first. */
  gaps: CaptureGap[];
  warnings: string[];
};

export type AuthExchangeRequest = { login: string };
export type AuthExchangeResponse = { token: string; expiresAt: number };

export type OkResponse = { ok: true };

/** Query parameter `stillwatch open` adds to the dashboard URL. */
export const LOGIN_QUERY_PARAM = 'login';

/**
 * API route handlers. Each returns an `ApiResult` that the server writes;
 * failures are thrown as `HttpError`.
 */
import type {
  AuthExchangeResponse,
  EventListResponse,
  EventView,
  OkResponse,
  SessionDetailResponse,
  SessionListResponse,
  SessionRecord,
  StatusResponse,
  StoredEvent,
} from '@stillwatch/schema';
import { isRecord } from '@stillwatch/schema';
import { buildSessionReport, describeEvent, renderMarkdownReport } from '@stillwatch/reports';
import type { Authenticator } from './auth';
import { badRequest, notFound, unauthorized } from './errors';
import { MARKDOWN_CONTENT_TYPE, NO_STORE } from './headers';
import { parseEventListQuery, parseSessionListQuery } from './query';
import type { ServerDeps } from './types';

export type ApiResult =
  | { kind: 'json'; status: number; body: unknown }
  | {
      kind: 'text';
      status: number;
      contentType: string;
      body: string;
      headers: Readonly<Record<string, string>>;
    };

export type HandlerContext = {
  deps: ServerDeps;
  auth: Authenticator;
  /** Validated `:id` path parameter, or null for routes without one. */
  id: string | null;
  query: URLSearchParams;
  /** Parsed JSON body, or null when there was none. */
  body: unknown;
};

/** A JSON result; the type argument checks `body` against the API response type. */
function json<T>(body: T, status = 200): { kind: 'json'; status: number; body: T } {
  return { kind: 'json', status, body };
}

function requireId(ctx: HandlerContext): string {
  if (ctx.id === null) throw badRequest('Missing id');
  return ctx.id;
}

function requireSession(ctx: HandlerContext, id: string): SessionRecord {
  const session = ctx.deps.store.getSession(id);
  if (!session) throw notFound('Session not found');
  return session;
}

function toEventView(
  ctx: HandlerContext,
  session: SessionRecord,
  event: StoredEvent,
  findingIds: Record<string, string[]>,
): EventView {
  const summary = describeEvent(event, {
    base: session.projectRoot ?? session.cwd,
    home: ctx.deps.userHome,
  });
  return { ...event, summary, findingIds: findingIds[event.id] ?? [] };
}

/** POST /api/auth/exchange */
export function exchangeLogin(ctx: HandlerContext): ApiResult {
  const body = ctx.body;
  if (!isRecord(body) || typeof body.login !== 'string' || Object.keys(body).length !== 1) {
    throw badRequest('Expected {"login": string}');
  }
  const result = ctx.auth.exchange(body.login);
  if (!result.ok) throw unauthorized('Login link is invalid, expired, or already used');
  return json<AuthExchangeResponse>(result.response);
}

/** GET /api/status */
export async function getStatus(ctx: HandlerContext): Promise<ApiResult> {
  return json<StatusResponse>(await ctx.deps.getStatus());
}

/** GET /api/sessions */
export function listSessions(ctx: HandlerContext): ApiResult {
  const query = parseSessionListQuery(ctx.query);
  return json<SessionListResponse>(ctx.deps.store.listSessions(query));
}

/** GET /api/sessions/:id */
export function getSession(ctx: HandlerContext): ApiResult {
  const detail = ctx.deps.store.getSessionDetail(requireId(ctx));
  if (!detail) throw notFound('Session not found');
  const report = buildSessionReport(detail, { now: ctx.deps.now(), home: ctx.deps.userHome });
  return json<SessionDetailResponse>({ ...detail, report });
}

/** GET /api/sessions/:id/events */
export function listEvents(ctx: HandlerContext): ApiResult {
  const id = requireId(ctx);
  const options = parseEventListQuery(ctx.query);
  const session = requireSession(ctx, id);
  const page = ctx.deps.store.listEvents(id, options);
  const findingIds = ctx.deps.store.findingIdsByEvent(id);
  return json<EventListResponse>({
    events: page.events.map((event) => toEventView(ctx, session, event, findingIds)),
    nextCursor: page.nextCursor,
  });
}

/** GET /api/events/:id */
export function getEvent(ctx: HandlerContext): ApiResult {
  const event = ctx.deps.store.getEvent(requireId(ctx));
  if (!event) throw notFound('Event not found');
  const session = requireSession(ctx, event.sessionId);
  const findingIds = ctx.deps.store.findingIdsByEvent(event.sessionId);
  return json<EventView>(toEventView(ctx, session, event, findingIds));
}

/** A filename made only of safe characters, whatever the session id contains. */
function reportFilename(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return `stillwatch-session-${safe}.md`;
}

/** GET /api/sessions/:id/report.md */
export function getReportMarkdown(ctx: HandlerContext): ApiResult {
  const id = requireId(ctx);
  const detail = ctx.deps.store.getSessionDetail(id);
  if (!detail) throw notFound('Session not found');
  const report = buildSessionReport(detail, { now: ctx.deps.now(), home: ctx.deps.userHome });
  return {
    kind: 'text',
    status: 200,
    contentType: MARKDOWN_CONTENT_TYPE,
    body: renderMarkdownReport(report),
    headers: {
      'Cache-Control': NO_STORE,
      'Content-Disposition': `attachment; filename="${reportFilename(id)}"`,
    },
  };
}

/** POST /api/sessions/:id/reanalyze */
export function reanalyzeSession(ctx: HandlerContext): ApiResult {
  const id = requireId(ctx);
  requireSession(ctx, id);
  ctx.deps.requestAnalysis(id);
  return json<OkResponse>({ ok: true });
}

/** DELETE /api/sessions/:id */
export function deleteSession(ctx: HandlerContext): ApiResult {
  const id = requireId(ctx);
  if (!ctx.deps.store.deleteSession(id)) throw notFound('Session not found');
  ctx.deps.onSessionDeleted(id);
  return json<OkResponse>({ ok: true });
}

/**
 * Typed client for the collector's local API (`packages/schema/src/api.ts`).
 * Every call except the login exchange carries the bearer token. A 401 signs
 * the dashboard out; a network failure marks the collector unreachable.
 */
import type {
  ApiErrorBody,
  AuthExchangeRequest,
  AuthExchangeResponse,
  EventListResponse,
  EventView,
  OkResponse,
  SessionDetailResponse,
  SessionListQuery,
  SessionListResponse,
  StatusResponse,
} from '@stillwatch/schema';
import { isRecord } from '@stillwatch/schema';
import type { AuthStore } from '../auth/auth';
import { ApiError, UnreachableError, isAbortError } from './errors';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ListQuery = Partial<SessionListQuery>;

export const EVENTS_PAGE_SIZE = 200;

export type ApiClient = {
  exchange(login: string): Promise<AuthExchangeResponse>;
  status(signal: AbortSignal | null): Promise<StatusResponse>;
  listSessions(query: ListQuery, signal: AbortSignal | null): Promise<SessionListResponse>;
  session(id: string, signal: AbortSignal | null): Promise<SessionDetailResponse>;
  events(
    sessionId: string,
    cursor: string | null,
    signal: AbortSignal | null,
  ): Promise<EventListResponse>;
  event(id: string, signal: AbortSignal | null): Promise<EventView>;
  reportMarkdown(id: string): Promise<{ text: string; filename: string }>;
  reanalyze(id: string): Promise<OkResponse>;
  deleteSession(id: string): Promise<OkResponse>;
};

/** Builds the query string for GET /api/sessions. Lists are comma-separated. */
export function sessionListSearch(query: ListQuery): string {
  const params = new URLSearchParams();
  if (query.risk && query.risk.length > 0) params.set('risk', query.risk.join(','));
  if (query.status && query.status.length > 0) params.set('status', query.status.join(','));
  if (query.q) params.set('q', query.q);
  if (query.projectId) params.set('projectId', query.projectId);
  if (query.sort) params.set('sort', query.sort);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

const UNREACHABLE_STATUSES = new Set([502, 503, 504]);

function filenameFrom(disposition: string | null, fallback: string): string {
  if (disposition === null) return fallback;
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const name = match?.[1]?.trim();
  // Only keep plain file names; never trust a path from a header.
  return name && /^[\w.-]{1,120}$/.test(name) ? name : fallback;
}

async function errorFrom(response: Response): Promise<ApiError> {
  let code = 'http_error';
  let message = `The collector returned an error (${response.status}).`;
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error)) {
      const error = (body as ApiErrorBody).error;
      if (typeof error.code === 'string') code = error.code;
      if (typeof error.message === 'string' && error.message !== '') message = error.message;
    }
  } catch {
    // Not JSON; keep the generic message.
  }
  return new ApiError(response.status, code, message);
}

export function createApiClient(options: { fetch: FetchLike; auth: AuthStore }): ApiClient {
  const { auth } = options;

  async function send(
    method: string,
    path: string,
    init: { body?: unknown; signal?: AbortSignal | null; authed?: boolean } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.authed !== false) {
      const token = auth.token();
      if (token === null) {
        auth.handleUnauthorized();
        throw new ApiError(401, 'unauthorized', 'Sign in to continue.');
      }
      headers.Authorization = `Bearer ${token}`;
    }
    const request: RequestInit = { method, headers, signal: init.signal ?? null };
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(init.body);
    }
    let response: Response;
    try {
      response = await options.fetch(path, request);
    } catch (error) {
      if (isAbortError(error)) throw error;
      auth.handleUnreachable();
      throw new UnreachableError();
    }
    if (response.ok) return response;
    if (UNREACHABLE_STATUSES.has(response.status)) {
      auth.handleUnreachable();
      throw new UnreachableError();
    }
    const error = await errorFrom(response);
    if (response.status === 401 && init.authed !== false) auth.handleUnauthorized();
    throw error;
  }

  async function json<T>(
    method: string,
    path: string,
    init: { body?: unknown; signal?: AbortSignal | null; authed?: boolean } = {},
  ): Promise<T> {
    const response = await send(method, path, init);
    const body: unknown = await response.json();
    return body as T;
  }

  const enc = encodeURIComponent;

  return {
    exchange(login) {
      const body: AuthExchangeRequest = { login };
      return json<AuthExchangeResponse>('POST', '/api/auth/exchange', { body, authed: false });
    },
    status: (signal) => json<StatusResponse>('GET', '/api/status', { signal }),
    listSessions: (query, signal) =>
      json<SessionListResponse>('GET', `/api/sessions${sessionListSearch(query)}`, { signal }),
    session: (id, signal) =>
      json<SessionDetailResponse>('GET', `/api/sessions/${enc(id)}`, { signal }),
    events(sessionId, cursor, signal) {
      const params = new URLSearchParams({ limit: String(EVENTS_PAGE_SIZE) });
      if (cursor !== null) params.set('cursor', cursor);
      return json<EventListResponse>('GET', `/api/sessions/${enc(sessionId)}/events?${params}`, {
        signal,
      });
    },
    event: (id, signal) => json<EventView>('GET', `/api/events/${enc(id)}`, { signal }),
    async reportMarkdown(id) {
      const response = await send('GET', `/api/sessions/${enc(id)}/report.md`);
      const text = await response.text();
      const fallback = `stillwatch-session-${id.replace(/[^\w-]/g, '').slice(0, 40)}.md`;
      return {
        text,
        filename: filenameFrom(response.headers.get('Content-Disposition'), fallback),
      };
    },
    reanalyze: (id) => json<OkResponse>('POST', `/api/sessions/${enc(id)}/reanalyze`),
    deleteSession: (id) => json<OkResponse>('DELETE', `/api/sessions/${enc(id)}`),
  };
}

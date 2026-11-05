/**
 * The API route table and path matching. `:id` segments are validated with
 * `parseId`. HEAD matches GET routes.
 */
import { methodNotAllowed, notFound } from './errors';
import {
  deleteSession,
  exchangeLogin,
  getEvent,
  getReportMarkdown,
  getSession,
  getStatus,
  listEvents,
  listSessions,
  reanalyzeSession,
  type ApiResult,
  type HandlerContext,
} from './handlers';
import { parseId } from './query';
import type { Method } from './request';

export type Route = {
  method: 'GET' | 'POST' | 'DELETE';
  /** Path segments; `:id` matches one id segment. */
  path: readonly string[];
  /** Route name for logs (never the concrete path). */
  name: string;
  /** False only for the login exchange. */
  auth: boolean;
  /** `required`: JSON body expected. `optional`: JSON body allowed and ignored if absent. */
  body: 'none' | 'optional' | 'required';
  /** True for the login exchange, which is rate limited. */
  rateLimited: boolean;
  handle: (ctx: HandlerContext) => ApiResult | Promise<ApiResult>;
};

const routes: readonly Route[] = [
  route('POST', 'api/auth/exchange', exchangeLogin, { auth: false, body: 'required' }),
  route('GET', 'api/status', getStatus),
  route('GET', 'api/sessions', listSessions),
  route('GET', 'api/sessions/:id', getSession),
  route('DELETE', 'api/sessions/:id', deleteSession),
  route('GET', 'api/sessions/:id/events', listEvents),
  route('GET', 'api/sessions/:id/report.md', getReportMarkdown),
  route('POST', 'api/sessions/:id/reanalyze', reanalyzeSession, { body: 'optional' }),
  route('GET', 'api/events/:id', getEvent),
];

function route(
  method: Route['method'],
  path: string,
  handle: Route['handle'],
  options: { auth?: boolean; body?: Route['body'] } = {},
): Route {
  const auth = options.auth ?? true;
  return {
    method,
    path: path.split('/'),
    name: `${method} /${path}`,
    auth,
    body: options.body ?? 'none',
    rateLimited: !auth,
    handle,
  };
}

/** True when the path is the one route that needs no bearer token. */
export function isPublicApiPath(segments: readonly string[]): boolean {
  return routes.some((r) => !r.auth && pathMatches(r.path, segments));
}

function pathMatches(pattern: readonly string[], segments: readonly string[]): boolean {
  return (
    pattern.length === segments.length &&
    pattern.every((part, i) => part === ':id' || part === segments[i])
  );
}

export type RouteMatch = { route: Route; id: string | null };

/** Finds the route for a method and path. Throws 404, or 405 with `Allow`. */
export function matchRoute(method: Method, segments: readonly string[]): RouteMatch {
  const candidates = routes.filter((r) => pathMatches(r.path, segments));
  if (candidates.length === 0) throw notFound();
  const wanted = method === 'HEAD' ? 'GET' : method;
  const found = candidates.find((r) => r.method === wanted);
  if (!found) {
    const allow = candidates.flatMap((r) => (r.method === 'GET' ? ['GET', 'HEAD'] : [r.method]));
    throw methodNotAllowed(allow);
  }
  const idIndex = found.path.indexOf(':id');
  const id = idIndex === -1 ? null : parseId(segments[idIndex] ?? '');
  return { route: found, id };
}

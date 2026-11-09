/**
 * Strict parsing of path ids and query strings. Unknown or repeated
 * parameters and out-of-range values are rejected with 400.
 */
import {
  RISK_LEVELS,
  SESSION_STATUSES,
  type RiskLevel,
  type SessionListQuery,
  type SessionStatus,
} from '@stillwatch/schema';
import { badRequest } from './errors';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CURSOR = /^[\x21-\x7e]{1,512}$/;
const MAX_SEARCH_LENGTH = 200;

/** Validates a session or event id from the path (length and charset). */
export function parseId(raw: string): string {
  if (!ID.test(raw)) throw badRequest('Invalid id');
  return raw;
}

/** Returns each parameter's single value, rejecting unknown and repeated names. */
function singleValues(params: URLSearchParams, allowed: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const [name, value] of params) {
    if (!allowed.includes(name)) throw badRequest(`Unknown query parameter`);
    if (values.has(name)) throw badRequest(`Repeated query parameter`);
    values.set(name, value);
  }
  return values;
}

function parseList<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  name: string,
): T[] | null {
  if (raw === undefined) return null;
  const items = raw.split(',');
  const result: T[] = [];
  for (const item of items) {
    const value = allowed.find((candidate) => candidate === item);
    if (value === undefined) throw badRequest(`Invalid ${name}`);
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  if (!/^\d{1,4}$/.test(raw)) throw badRequest('Invalid limit');
  const limit = Number(raw);
  if (limit < 1 || limit > max) throw badRequest('Invalid limit');
  return limit;
}

function parseCursor(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  if (!CURSOR.test(raw)) throw badRequest('Invalid cursor');
  return raw;
}

/** Parses the GET /api/sessions query string. */
export function parseSessionListQuery(params: URLSearchParams): SessionListQuery {
  const values = singleValues(params, [
    'risk',
    'status',
    'q',
    'projectId',
    'sort',
    'limit',
    'cursor',
  ]);
  const sort = values.get('sort') ?? 'review';
  if (sort !== 'review' && sort !== 'recent') throw badRequest('Invalid sort');
  const q = values.get('q')?.trim() ?? '';
  if (q.length > MAX_SEARCH_LENGTH) throw badRequest('Invalid q');
  const projectId = values.get('projectId');
  if (projectId !== undefined && !ID.test(projectId)) throw badRequest('Invalid projectId');
  return {
    risk: parseList<RiskLevel>(values.get('risk'), RISK_LEVELS, 'risk'),
    status: parseList<SessionStatus>(values.get('status'), SESSION_STATUSES, 'status'),
    q: q === '' ? null : q,
    projectId: projectId ?? null,
    sort,
    limit: parseLimit(values.get('limit'), 50, 200),
    cursor: parseCursor(values.get('cursor')),
  };
}

/** Parses the GET /api/sessions/:id/events query string. */
export function parseEventListQuery(params: URLSearchParams): {
  cursor: string | null;
  limit: number;
} {
  const values = singleValues(params, ['cursor', 'limit']);
  return {
    cursor: parseCursor(values.get('cursor')),
    limit: parseLimit(values.get('limit'), 200, 500),
  };
}

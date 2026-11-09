/**
 * Writes JSON, text, and error responses with an exact `Content-Length`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { errorBody, type HttpError } from './errors';
import { JSON_CONTENT_TYPE, NO_STORE } from './headers';

/** Sends a body with the given type. Node drops the body itself for HEAD requests. */
export function sendBody(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
  headers: Readonly<Record<string, string>> = {},
): void {
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res.statusCode = status;
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', payload.length);
  res.end(payload);
}

/** Sends `value` as JSON that is never cached. */
export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  sendBody(res, status, JSON_CONTENT_TYPE, JSON.stringify(value), { 'Cache-Control': NO_STORE });
}

/**
 * Sends an `ApiErrorBody`. When the request body was not fully read, the
 * connection is closed afterwards so leftover bytes are never parsed as a
 * second request.
 */
export function sendError(req: IncomingMessage, res: ServerResponse, error: HttpError): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (!req.complete) res.setHeader('Connection', 'close');
  sendBody(res, error.status, JSON_CONTENT_TYPE, JSON.stringify(errorBody(error)), {
    ...error.headers,
    'Cache-Control': NO_STORE,
  });
}

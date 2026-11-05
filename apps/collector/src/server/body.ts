/**
 * Reads small JSON request bodies with a size cap and a read timeout.
 */
import type { IncomingMessage } from 'node:http';
import { badRequest, HttpError } from './errors';
import { declaresBody } from './request';

export type BodyLimits = { maxBytes: number; timeoutMs: number };

function payloadTooLarge(): HttpError {
  return new HttpError(413, 'payload_too_large', 'Request body too large');
}

/** Rejects (415) a body whose media type is not JSON in UTF-8. */
function checkContentType(header: string | undefined): void {
  const [type = '', ...params] = (header ?? '').split(';').map((part) => part.trim().toLowerCase());
  const charsetOk = params.every(
    (param) => !param.startsWith('charset=') || /^charset="?utf-8"?$/.test(param),
  );
  if (type !== 'application/json' || !charsetOk) {
    throw new HttpError(415, 'unsupported_media_type', 'Expected application/json');
  }
}

function readRaw(req: IncomingMessage, limits: BodyLimits): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (error: HttpError | null): void => {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      if (error) {
        // Keep draining so the error response is not lost to a connection reset.
        req.resume();
        reject(error);
      } else {
        resolve(Buffer.concat(chunks, size));
      }
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limits.maxBytes) finish(payloadTooLarge());
      else chunks.push(chunk);
    };
    const onEnd = (): void => {
      finish(null);
    };
    const onError = (): void => {
      finish(badRequest('Request body could not be read'));
    };
    const timer = setTimeout(() => {
      finish(new HttpError(408, 'request_timeout', 'Request body timed out'));
    }, limits.timeoutMs);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/**
 * Reads and parses a JSON body. Returns null when the request has no body.
 * Throws 413 above `maxBytes` (checked against Content-Length before reading),
 * 415 for other media types, 408 on timeout, and 400 for invalid UTF-8 or JSON.
 */
export async function readJsonBody(req: IncomingMessage, limits: BodyLimits): Promise<unknown> {
  if (!declaresBody(req)) return null;
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > limits.maxBytes) throw payloadTooLarge();
  checkContentType(req.headers['content-type']);
  const raw = await readRaw(req, limits);
  if (raw.length === 0) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    throw badRequest('Request body is not valid UTF-8');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest('Request body is not valid JSON');
  }
}

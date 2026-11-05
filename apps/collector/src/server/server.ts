/**
 * Creates the HTTP server, binds it to 127.0.0.1, and runs every request
 * through the guards: security headers, method, Host, Origin, target
 * parsing, then either the API (auth, rate limit, body, handler) or static
 * files. Logs carry route names and status codes only, never paths with
 * query strings, bodies, or tokens.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { Authenticator, decodeAuthSecret } from './auth';
import { readJsonBody } from './body';
import { badRequest, HttpError, internalError, unauthorized } from './errors';
import { applySecurityHeaders, NO_STORE, securityHeaderLines } from './headers';
import type { HandlerContext } from './handlers';
import { MAX_HEADER_BYTES, type ServerLimits } from './limits';
import { SlidingWindowLimiter } from './rate-limit';
import {
  checkHost,
  checkOrigin,
  declaresBody,
  parseMethod,
  parseTarget,
  type Method,
  type Target,
} from './request';
import { sendBody, sendError, sendJson } from './respond';
import { isPublicApiPath, matchRoute } from './router';
import { createStaticSite, type StaticSite } from './static';
import type { HttpServerHandle, ServerDeps } from './types';

const LOOPBACK = '127.0.0.1';

type ServerState = {
  deps: ServerDeps;
  limits: ServerLimits;
  auth: Authenticator;
  exchangeLimiter: SlidingWindowLimiter;
  site: StaticSite;
  port: number;
};

async function handleApi(
  state: ServerState,
  method: Method,
  target: Target,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<string> {
  res.setHeader('Cache-Control', NO_STORE);
  if (
    !isPublicApiPath(target.segments) &&
    !state.auth.verifyAuthorization(req.headers.authorization)
  ) {
    throw unauthorized();
  }
  const { route, id } = matchRoute(method, target.segments);
  if (route.rateLimited) {
    const retryAfter = state.exchangeLimiter.take();
    if (retryAfter > 0) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts', {
        'Retry-After': String(retryAfter),
      });
    }
  }
  if (route.body === 'none' && declaresBody(req)) throw badRequest('Request body not allowed');
  const body =
    route.body === 'none'
      ? null
      : await readJsonBody(req, {
          maxBytes: state.limits.maxBodyBytes,
          timeoutMs: state.limits.bodyTimeoutMs,
        });
  if (route.body === 'required' && body === null) throw badRequest('Request body required');
  const ctx: HandlerContext = { deps: state.deps, auth: state.auth, id, query: target.query, body };
  const result = await route.handle(ctx);
  if (result.kind === 'json') sendJson(res, result.status, result.body);
  else sendBody(res, result.status, result.contentType, result.body, result.headers);
  return route.name;
}

async function handle(
  state: ServerState,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<string> {
  const method = parseMethod(req.method);
  checkHost(req.headers.host, state.port);
  checkOrigin(method, req.headers.origin, state.port);
  const target = parseTarget(req.url);
  if (target.isApi) return handleApi(state, method, target, req, res);
  if (method !== 'POST' && declaresBody(req)) throw badRequest('Request body not allowed');
  await state.site.serve({ method, target, req }, res);
  return 'static';
}

async function onRequest(
  state: ServerState,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const started = performance.now();
  applySecurityHeaders(res);
  let name = 'unrouted';
  try {
    name = await handle(state, req, res);
  } catch (error) {
    if (error instanceof HttpError) {
      sendError(req, res, error);
    } else {
      state.deps.logger.error('request failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      sendError(req, res, internalError());
    }
  }
  state.deps.logger.debug('request', {
    route: name,
    status: res.statusCode,
    ms: Math.round(performance.now() - started),
  });
}

/** Answers malformed requests with a bare response that still carries the security headers. */
function onClientError(error: Error & { code?: string }, socket: Socket): void {
  if (error.code === 'ECONNRESET' || !socket.writable) {
    socket.destroy();
    return;
  }
  const status =
    error.code === 'HPE_HEADER_OVERFLOW'
      ? '431 Request Header Fields Too Large'
      : error.code === 'ERR_HTTP_REQUEST_TIMEOUT'
        ? '408 Request Timeout'
        : '400 Bad Request';
  socket.end(
    `HTTP/1.1 ${status}\r\n${securityHeaderLines()}Cache-Control: no-store\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
  );
}

/** Starts the server with explicit limits. `startHttpServer` uses `DEFAULT_LIMITS`. */
export async function startServer(
  deps: ServerDeps,
  limits: ServerLimits,
): Promise<HttpServerHandle> {
  const key = decodeAuthSecret(deps.config.authSecret);
  const state: ServerState = {
    deps,
    limits,
    auth: new Authenticator(key, deps.now),
    exchangeLimiter: new SlidingWindowLimiter(
      limits.exchangeLimit,
      limits.exchangeWindowMs,
      deps.now,
    ),
    site: await createStaticSite(deps.webRoot, deps.logger),
    port: deps.port,
  };
  const server = createServer({
    maxHeaderSize: MAX_HEADER_BYTES,
    requireHostHeader: true,
    headersTimeout: limits.headersTimeoutMs,
    requestTimeout: limits.requestTimeoutMs,
    keepAliveTimeout: limits.keepAliveTimeoutMs,
    connectionsCheckingInterval: 1_000,
  });
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    void onRequest(state, req, res);
  });
  server.on('clientError', onClientError);
  server.maxRequestsPerSocket = 1_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port: deps.port, host: LOOPBACK, exclusive: true }, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('server has no TCP address');
  }
  state.port = address.port;
  server.on('error', (error) => {
    deps.logger.error('http server error', { error: error.name });
  });
  deps.logger.info('http server listening', { port: state.port });

  return {
    port: state.port,
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      }),
  };
}

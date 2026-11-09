/**
 * The collector's local HTTP server: API, auth, security headers, and static
 * dashboard files. Internal contract between the collector core (which calls
 * `startHttpServer`) and the server implementation. See docs/architecture.md
 * ("Local server and dashboard") and the route list in @stillwatch/schema api.ts.
 */
import { LOGIN_QUERY_PARAM, type StillwatchConfig } from '@stillwatch/schema';
import { createLoginToken, decodeAuthSecret } from './auth';
import { DEFAULT_LIMITS } from './limits';
import { startServer } from './server';
import type { HttpServerHandle, ServerDeps } from './types';

export type { HttpServerHandle, ServerDeps } from './types';

/** Starts the server on 127.0.0.1:`deps.port`. Rejects when the port is taken. */
export function startHttpServer(deps: ServerDeps): Promise<HttpServerHandle> {
  return startServer(deps, DEFAULT_LIMITS);
}

/**
 * Single-use login link for the dashboard:
 * `http://127.0.0.1:<port>/?login=<ts>.<nonce>.<sig>` where
 * sig = base64url(HMAC-SHA256(authSecret, "login\n" + ts + "\n" + nonce)).
 * The dashboard exchanges it at POST /api/auth/exchange for a bearer token
 * `v1.<expiresAt>.<sig>` (sig over "api\n" + expiresAt), valid 30 days.
 * Links expire after 120 seconds and are single-use (nonces kept in memory).
 */
export function createLoginUrl(config: StillwatchConfig, options?: { now?: number }): string {
  const token = createLoginToken(decodeAuthSecret(config.authSecret), options?.now ?? Date.now());
  return `http://127.0.0.1:${config.port}/?${LOGIN_QUERY_PARAM}=${token}`;
}

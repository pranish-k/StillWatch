/**
 * The collector's local HTTP server: API, auth, security headers, and static
 * dashboard files. Internal contract between the collector core (which calls
 * `startHttpServer`) and the server implementation. See docs/architecture.md
 * ("Local server and dashboard") and the route list in @stillwatch/schema api.ts.
 */
import type { Server } from 'node:http';
import type { StatusResponse, StillwatchConfig } from '@stillwatch/schema';
import type { Store } from '@stillwatch/storage';
import type { Logger } from '../types';

export type ServerDeps = {
  store: Store;
  config: StillwatchConfig;
  version: string;
  /** Built dashboard directory, or null to serve a short "dashboard not built" page. */
  webRoot: string | null;
  /** 0 picks a free port (tests). Always binds 127.0.0.1. */
  port: number;
  logger: Logger;
  now: () => number;
  /** The user's home directory, for path display in reports. */
  userHome: string;
  /** Builds the /api/status payload. Implemented by the collector core. */
  getStatus: () => Promise<StatusResponse>;
  /** Asks the pipeline to re-analyze a session soon. */
  requestAnalysis: (sessionId: string) => void;
  /** Called after a session is deleted through the API. */
  onSessionDeleted: (sessionId: string) => void;
};

export type HttpServerHandle = {
  readonly port: number;
  readonly server: Server;
  close(): Promise<void>;
};

export function startHttpServer(_deps: ServerDeps): Promise<HttpServerHandle> {
  return Promise.reject(new Error('not implemented: startHttpServer'));
}

/**
 * Single-use login link for the dashboard:
 * `http://127.0.0.1:<port>/?login=<ts>.<nonce>.<sig>` where
 * sig = base64url(HMAC-SHA256(authSecret, "login\n" + ts + "\n" + nonce)).
 * The dashboard exchanges it at POST /api/auth/exchange for a bearer token
 * `v1.<expiresAt>.<sig>` (sig over "api\n" + expiresAt), valid 30 days.
 * Links expire after 120 seconds and are single-use (nonces kept in memory).
 */
export function createLoginUrl(_config: StillwatchConfig, _options?: { now?: number }): string {
  throw new Error('not implemented: createLoginUrl');
}

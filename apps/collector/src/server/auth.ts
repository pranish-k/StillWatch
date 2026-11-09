/**
 * Dashboard authentication (ADR-022).
 *
 * Login token: `<ts>.<nonce>.<sig>`, sig = base64url(HMAC-SHA256(key, "login\n" + ts + "\n" + nonce)),
 * ts in epoch milliseconds, nonce 16 random bytes in base64url. Valid for
 * 120 seconds around `ts` and accepted once.
 *
 * API token: `v1.<expiresAt>.<sig>`, sig = base64url(HMAC-SHA256(key, "api\n" + expiresAt)),
 * valid for 30 days.
 *
 * Signatures are compared with `timingSafeEqual`. Tokens are never logged.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthExchangeResponse } from '@stillwatch/schema';

export const LOGIN_TTL_MS = 120_000;
export const API_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Nonces remembered at most; beyond this, exchanges fail closed until old ones expire. */
const MAX_REMEMBERED_NONCES = 4_096;

const LOGIN_TOKEN = /^(\d{1,16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const API_TOKEN = /^v1\.(\d{1,16})\.([A-Za-z0-9_-]{43})$/;
const BEARER = /^Bearer ([\x21-\x7e]{1,256})$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Decodes the base64url `authSecret` from config. Throws when it is missing or too short. */
export function decodeAuthSecret(secret: string): Buffer {
  const key = BASE64URL.test(secret) ? Buffer.from(secret, 'base64url') : Buffer.alloc(0);
  if (key.length < 16) throw new Error('authSecret must be base64url with at least 16 bytes');
  return key;
}

function sign(key: Buffer, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('base64url');
}

/** Constant-time comparison of two ASCII signatures. */
function signaturesMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'ascii');
  const b = Buffer.from(actual, 'ascii');
  return a.length === b.length && timingSafeEqual(a, b);
}

function loginMessage(ts: string, nonce: string): string {
  return `login\n${ts}\n${nonce}`;
}

/** Creates a single-use login token. `nonce` is only passed by tests. */
export function createLoginToken(key: Buffer, now: number, nonce?: string): string {
  const ts = String(Math.floor(now));
  const n = nonce ?? randomBytes(16).toString('base64url');
  return `${ts}.${n}.${sign(key, loginMessage(ts, n))}`;
}

/** Creates an API bearer token valid for `API_TOKEN_TTL_MS`. */
export function issueApiToken(key: Buffer, now: number): AuthExchangeResponse {
  const expiresAt = Math.floor(now) + API_TOKEN_TTL_MS;
  return { token: `v1.${expiresAt}.${sign(key, `api\n${expiresAt}`)}`, expiresAt };
}

/** True when `token` is an API token signed with `key` that has not expired. */
export function verifyApiToken(key: Buffer, token: string, now: number): boolean {
  const match = API_TOKEN.exec(token);
  if (!match) return false;
  const [, expires = '', sig = ''] = match;
  if (!signaturesMatch(sign(key, `api\n${expires}`), sig)) return false;
  return Number(expires) > now;
}

export type LoginFailure = 'malformed' | 'bad_signature' | 'expired' | 'replayed';

export type ExchangeResult =
  { ok: true; response: AuthExchangeResponse } | { ok: false; reason: LoginFailure };

/** Verifies login tokens once each and checks bearer tokens. One per server. */
export class Authenticator {
  readonly #key: Buffer;
  readonly #now: () => number;
  /** Used nonce to the time after which its login token is expired anyway. */
  readonly #usedNonces = new Map<string, number>();

  constructor(key: Buffer, now: () => number) {
    this.#key = key;
    this.#now = now;
  }

  /** Exchanges a login token for an API token. Each nonce is accepted once. */
  exchange(login: string): ExchangeResult {
    const match = LOGIN_TOKEN.exec(login);
    if (!match) return { ok: false, reason: 'malformed' };
    const [, ts = '', nonce = '', sig = ''] = match;
    if (!signaturesMatch(sign(this.#key, loginMessage(ts, nonce)), sig)) {
      return { ok: false, reason: 'bad_signature' };
    }
    const now = this.#now();
    const issuedAt = Number(ts);
    if (Math.abs(now - issuedAt) > LOGIN_TTL_MS) return { ok: false, reason: 'expired' };
    this.#prune(now);
    if (this.#usedNonces.has(nonce) || this.#usedNonces.size >= MAX_REMEMBERED_NONCES) {
      return { ok: false, reason: 'replayed' };
    }
    this.#usedNonces.set(nonce, issuedAt + LOGIN_TTL_MS);
    return { ok: true, response: issueApiToken(this.#key, now) };
  }

  /** True when the `Authorization` header carries a valid, unexpired API token. */
  verifyAuthorization(header: string | undefined): boolean {
    if (header === undefined) return false;
    const match = BEARER.exec(header);
    if (!match) return false;
    return verifyApiToken(this.#key, match[1] ?? '', this.#now());
  }

  #prune(now: number): void {
    for (const [nonce, expiresAt] of this.#usedNonces) {
      if (expiresAt < now) this.#usedNonces.delete(nonce);
    }
  }
}

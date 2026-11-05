import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  API_TOKEN_TTL_MS,
  Authenticator,
  createLoginToken,
  decodeAuthSecret,
  issueApiToken,
  LOGIN_TTL_MS,
  verifyApiToken,
} from './auth';
import { createLoginUrl } from './index';
import { fakeConfig } from './test-support';

const NOW = 1_700_000_000_000;

function setup() {
  const key = randomBytes(32);
  const clock = { now: NOW };
  return { key, clock, auth: new Authenticator(key, () => clock.now) };
}

describe('login tokens', () => {
  it('signs ts and nonce with HMAC-SHA256 over "login\\n" + ts + "\\n" + nonce', () => {
    const key = randomBytes(32);
    const token = createLoginToken(key, NOW);
    const [ts, nonce, sig] = token.split('.');
    expect(ts).toBe(String(NOW));
    expect(Buffer.from(nonce!, 'base64url')).toHaveLength(16);
    const expected = createHmac('sha256', key)
      .update(`login\n${ts!}\n${nonce!}`)
      .digest('base64url');
    expect(sig).toBe(expected);
  });

  it('exchanges a valid login once for a 30 day API token', () => {
    const { key, auth } = setup();
    const result = auth.exchange(createLoginToken(key, NOW - 1_000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.expiresAt).toBe(NOW + API_TOKEN_TTL_MS);
    expect(result.response.token).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(verifyApiToken(key, result.response.token, NOW)).toBe(true);
  });

  it('rejects a replayed nonce', () => {
    const { key, auth } = setup();
    const login = createLoginToken(key, NOW);
    expect(auth.exchange(login).ok).toBe(true);
    expect(auth.exchange(login)).toEqual({ ok: false, reason: 'replayed' });
  });

  it('rejects a bad signature, including one from another key', () => {
    const { key, auth } = setup();
    const login = createLoginToken(key, NOW);
    const tampered = `${login.slice(0, -1)}${login.endsWith('A') ? 'B' : 'A'}`;
    expect(auth.exchange(tampered)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(auth.exchange(createLoginToken(randomBytes(32), NOW))).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects links older or newer than 120 seconds', () => {
    const { key, auth } = setup();
    expect(auth.exchange(createLoginToken(key, NOW - LOGIN_TTL_MS)).ok).toBe(true);
    expect(auth.exchange(createLoginToken(key, NOW - LOGIN_TTL_MS - 1))).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(auth.exchange(createLoginToken(key, NOW + LOGIN_TTL_MS + 1))).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects malformed tokens', () => {
    const { key, auth } = setup();
    const valid = createLoginToken(key, NOW);
    for (const login of ['', 'a.b.c', `${valid}.x`, valid.replace('.', ''), ` ${valid}`]) {
      expect(auth.exchange(login)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('forgets nonces once their links have expired anyway', () => {
    const { key, auth, clock } = setup();
    const nonce = randomBytes(16).toString('base64url');
    expect(auth.exchange(createLoginToken(key, NOW, nonce)).ok).toBe(true);
    clock.now = NOW + LOGIN_TTL_MS + 1;
    // Pruned, but the old link is still rejected by its timestamp.
    expect(auth.exchange(createLoginToken(key, NOW, nonce))).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(auth.exchange(createLoginToken(key, clock.now)).ok).toBe(true);
  });
});

describe('API tokens', () => {
  it('rejects expired, foreign, and malformed tokens', () => {
    const { key, auth, clock } = setup();
    const { token, expiresAt } = issueApiToken(key, NOW);
    expect(auth.verifyAuthorization(`Bearer ${token}`)).toBe(true);
    expect(auth.verifyAuthorization(token)).toBe(false);
    expect(auth.verifyAuthorization(`bearer ${token}`)).toBe(false);
    expect(auth.verifyAuthorization(undefined)).toBe(false);
    expect(auth.verifyAuthorization(`Bearer ${issueApiToken(randomBytes(32), NOW).token}`)).toBe(
      false,
    );
    expect(auth.verifyAuthorization(`Bearer ${token.replace('v1.', 'v2.')}`)).toBe(false);
    // A later expiry with the old signature does not verify.
    expect(
      auth.verifyAuthorization(`Bearer ${token.replace(String(expiresAt), '9999999999999')}`),
    ).toBe(false);
    clock.now = expiresAt;
    expect(auth.verifyAuthorization(`Bearer ${token}`)).toBe(false);
  });
});

describe('createLoginUrl', () => {
  it('builds a link on 127.0.0.1 with the login query parameter', () => {
    const config = { ...fakeConfig(), port: 7400 };
    const url = new URL(createLoginUrl(config, { now: NOW }));
    expect(url.origin).toBe('http://127.0.0.1:7400');
    expect(url.pathname).toBe('/');
    const login = url.searchParams.get('login') ?? '';
    const auth = new Authenticator(decodeAuthSecret(config.authSecret), () => NOW);
    expect(auth.exchange(login).ok).toBe(true);
  });

  it('refuses a missing or short secret', () => {
    expect(() => createLoginUrl({ ...fakeConfig(), authSecret: '' })).toThrow();
    expect(() => decodeAuthSecret('abc')).toThrow();
    expect(() => decodeAuthSecret('not base64url!')).toThrow();
  });
});

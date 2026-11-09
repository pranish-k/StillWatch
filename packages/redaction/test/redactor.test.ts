import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LIMITS, isTruncated, type JsonValue } from '@stillwatch/schema';
import { describe, expect, it } from 'vitest';
import { createRedactor } from '../src/index';
import { fake, KEY, randomish, redactor } from './fakes';

const r = redactor();

describe('fingerprints', () => {
  it('are stable for a key and equal for equal secrets', () => {
    const secret = fake.githubClassic();
    const a = r.redactString(`one ${secret} two ${secret}`);
    const b = redactor().redactString(secret);
    expect(a.redactions).toEqual([
      {
        pointer: '',
        detector: 'github-token',
        fingerprint: b.redactions[0]?.fingerprint,
        count: 2,
      },
    ]);
    expect(a.redactions[0]?.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it('depend on the key, and accept raw bytes equal to the decoded key', () => {
    const secret = fake.npm();
    const fp = (key: string | Uint8Array) =>
      createRedactor({ fingerprintKey: key }).redactString(secret).redactions[0]?.fingerprint;
    expect(fp(KEY)).toBe(fp(new Uint8Array(Buffer.from(KEY, 'base64url'))));
    expect(fp(KEY)).not.toBe(fp(Buffer.alloc(32, 8).toString('base64url')));
  });

  it('rejects empty and malformed keys', () => {
    expect(() => createRedactor({ fingerprintKey: '' })).toThrow(TypeError);
    expect(() => createRedactor({ fingerprintKey: new Uint8Array() })).toThrow(TypeError);
    expect(() => createRedactor({ fingerprintKey: 'not base64url!' })).toThrow(TypeError);
  });
});

describe('redactString', () => {
  it('records the pointer and counts per detector and fingerprint', () => {
    const a = fake.stripe();
    const b = fake.awsAccessKeyId();
    const result = r.redactString(`${a} ${b} ${a}`, '/payload/x');
    expect(result.redactions.map((x) => [x.pointer, x.detector, x.count])).toEqual([
      ['/payload/x', 'aws-access-key-id', 1],
      ['/payload/x', 'stripe-key', 2],
    ]);
  });

  it('is idempotent on already-redacted text', () => {
    const text = [
      fake.privateKey(),
      `API_KEY=${fake.openaiProject()}`,
      `postgres://u:${'pw' + 'Zq9x'}@h/db`,
      `Authorization: Bearer ${randomish(40, 3)}`,
      `password: "${'Qz8' + 'Wx7Ec6'}"`,
      `token ${randomish(48, 4)}`,
      fake.jwt(),
      `Cookie: sid=${'Ab1' + 'Cd2Ef3'}; x=y`,
    ].join('\n');
    const once = r.redactString(text);
    expect(once.redactions.length).toBeGreaterThanOrEqual(8);
    const twice = r.redactString(once.value);
    expect(twice.value).toBe(once.value);
    expect(twice.redactions).toEqual([]);
  });

  it('cuts strings over LIMITS.hardStringCap before scanning', () => {
    const secret = fake.githubClassic();
    const text = `${secret} ` + 'a '.repeat(LIMITS.hardStringCap);
    const out = r.redactString(text).value;
    expect(out.startsWith('[REDACTED:github-token:')).toBe(true);
    expect(isTruncated(out)).toBe(true);
    expect(out.length).toBeLessThan(LIMITS.hardStringCap + 40);
  });
});

describe('redactJson', () => {
  it('escapes pointer tokens per RFC 6901 and keeps keys', () => {
    const secret = fake.slackToken();
    const input = { 'a/b': { 'c~d': [`x ${secret}`] } };
    const result = r.redactJson(input, '/payload');
    expect(Object.keys(result.value)).toEqual(['a/b']);
    expect(result.redactions[0]?.pointer).toBe('/payload/a~1b/c~0d/0');
  });

  it('redacts secret-named fields whole and keeps placeholders', () => {
    const input = {
      password: 'correct' + 'Horse9',
      api_key: 'Bearer ' + randomish(20, 5),
      token: '',
      secret: '${SECRET}',
      clientSecret: fake.stripe(),
      passwordHint: 'your pet',
      token_type: 'bearer',
      max_tokens: 4096,
      nested: { auth: { user: 'dev', pass: 'Zq8' + 'xW7v' } },
    };
    const { value, redactions } = r.redactJson(input);
    expect(value.password).toMatch(/^\[REDACTED:secret-field:[0-9a-f]{8}\]$/);
    expect(value.api_key).toMatch(/^\[REDACTED:secret-field:[0-9a-f]{8}\]$/);
    expect(value.token).toBe('');
    expect(value.secret).toBe('${SECRET}');
    expect(value.clientSecret).toMatch(/^\[REDACTED:stripe-key:[0-9a-f]{8}\]$/);
    expect(value.passwordHint).toBe('your pet');
    expect(value.token_type).toBe('bearer');
    expect(value.max_tokens).toBe(4096);
    expect(value.nested.auth.user).toBe('dev');
    expect(value.nested.auth.pass).toMatch(/^\[REDACTED:secret-field:/);
    expect(redactions.map((x) => x.pointer)).toEqual([
      '/password',
      '/api_key',
      '/clientSecret',
      '/nested/auth/pass',
    ]);
    expect(r.redactJson(value)).toEqual({ value, redactions: [] });
  });

  it('does not mutate the input and handles __proto__ keys', () => {
    const input = JSON.parse(
      '{"__proto__": {"password": "Qw9' + 'er8Ty"}, "list": ["a", 1, null, true]}',
    ) as JsonValue;
    const snapshot = JSON.stringify(input);
    const { value } = r.redactJson(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(JSON.stringify(value)).toMatch(/^\{"__proto__":\{"password":"\[REDACTED:secret-field:/);
  });

  it('walks very deep values without overflowing the stack', () => {
    let deep: JsonValue = fake.npm();
    for (let i = 0; i < 20_000; i++) deep = [deep];
    const { redactions } = r.redactJson(deep);
    expect(redactions).toHaveLength(1);
    expect(redactions[0]?.pointer).toBe('/0'.repeat(20_000));
  });

  it('rejects cyclic values', () => {
    const a: JsonValue[] = [];
    a.push(a);
    expect(() => r.redactJson(a)).toThrow(/cyclic/);
  });
});

describe('real session fixture', () => {
  const path = fileURLToPath(
    new URL('../../../lab/fixtures/claude-code/real-session-2.1.318.json', import.meta.url),
  );
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as { records: JsonValue };

  it('redacts the fake .env.test value and nothing else', () => {
    const { value, redactions } = r.redactJson(fixture.records);
    const fp = redactions[0]?.fingerprint ?? '';
    expect(redactions).toEqual([
      {
        pointer: '/16/payload/tool_response/stdout',
        detector: 'env-assignment',
        fingerprint: fp,
        count: 1,
      },
      {
        pointer: '/19/payload/tool_calls/1/tool_response',
        detector: 'env-assignment',
        fingerprint: fp,
        count: 1,
      },
    ]);
    const text = JSON.stringify(value);
    expect(text).not.toContain('FAKEFAKE');
    expect(text).toContain(`"stdout":"API_KEY=[REDACTED:env-assignment:${fp}]"`);
  });
});

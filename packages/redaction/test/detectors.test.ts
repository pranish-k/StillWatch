import { findRedactionMarkers } from '@stillwatch/schema';
import { describe, expect, it } from 'vitest';
import { DETECTORS, shannonEntropy } from '../src/index';
import { fake, randomish, redactor } from './fakes';

const r = redactor();

/** Detector ids of the markers in the redacted text. */
function detected(text: string): string[] {
  return findRedactionMarkers(r.redactString(text).value).map((m) => m.detector);
}

function expectRedacted(text: string, secret: string, detector: string): string {
  const out = r.redactString(text).value;
  expect(out).not.toContain(secret);
  expect(detected(text)).toContain(detector);
  return out;
}

function expectUntouched(text: string): void {
  expect(r.redactString(text).value).toBe(text);
}

describe('DETECTORS', () => {
  it('lists every detector once, in run order, with kebab-case ids', () => {
    const ids = DETECTORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(ids[0]).toBe('private-key');
    expect(ids.at(-2)).toBe('high-entropy');
    expect(ids.at(-1)).toBe('secret-field');
    expect(ids).toEqual(
      expect.arrayContaining([
        'aws-access-key-id',
        'aws-secret-access-key',
        'github-token',
        'gitlab-token',
        'slack-token',
        'slack-webhook',
        'stripe-key',
        'anthropic-key',
        'openai-key',
        'google-api-key',
        'npm-token',
        'pypi-token',
        'sendgrid-key',
        'twilio-key',
        'shopify-token',
        'jwt',
        'url-credentials',
        'authorization-header',
        'env-assignment',
      ]),
    );
  });
});

describe('private-key', () => {
  it.each(['', 'RSA ', 'EC ', 'DSA ', 'OPENSSH ', 'ENCRYPTED '])('redacts a %sblock whole', (t) => {
    const key = fake.privateKey(t);
    const out = expectRedacted(`before\n${key}\nafter`, key, 'private-key');
    expect(out).toMatch(/^before\n\[REDACTED:private-key:[0-9a-f]{8}\]\nafter$/);
  });

  it('redacts a PGP private key block', () => {
    const block =
      '-----' +
      'BEGIN PGP PRIVATE KEY BLOCK-----\n\n' +
      randomish(64, 31) +
      '\n-----END PGP PRIVATE KEY BLOCK-----';
    expect(r.redactString(block).value).toMatch(/^\[REDACTED:private-key:[0-9a-f]{8}\]$/);
  });

  it('redacts an unterminated block to the end of the string', () => {
    const text = 'x ' + (fake.privateKey().split('-----END')[0] ?? '');
    expect(r.redactString(text).value).toMatch(/^x \[REDACTED:private-key:[0-9a-f]{8}\]$/);
  });

  it('keeps a header without key material, such as parser code', () => {
    expectUntouched(
      "if (line.startsWith('-----BEGIN PRIVATE KEY-----')) { return parse(line); } // -----END",
    );
    const publicKey =
      '-----BEGIN PUBLIC KEY-----\n' + randomish(64, 2) + '\n-----END PUBLIC KEY-----';
    expect(detected(publicKey)).not.toContain('private-key');
  });
});

describe('vendor tokens', () => {
  const cases: [string, () => string][] = [
    ['aws-access-key-id', fake.awsAccessKeyId],
    ['github-token', fake.githubClassic],
    ['github-token', fake.githubPat],
    ['gitlab-token', fake.gitlab],
    ['slack-token', fake.slackToken],
    ['stripe-key', fake.stripe],
    ['anthropic-key', fake.anthropic],
    ['openai-key', fake.openaiProject],
    ['openai-key', fake.openaiLegacy],
    ['google-api-key', fake.google],
    ['npm-token', fake.npm],
    ['pypi-token', fake.pypi],
    ['sendgrid-key', fake.sendgrid],
    ['twilio-key', fake.twilio],
    ['shopify-token', fake.shopify],
    ['jwt', fake.jwt],
  ];

  it.each(cases)('%s: redacts the token and keeps surrounding text', (id, make) => {
    const secret = make();
    const out = expectRedacted(`use ${secret} now`, secret, id);
    expect(out).toMatch(new RegExp(`^use \\[REDACTED:${id}:[0-9a-f]{8}\\] now$`));
  });

  it.each(cases)('%s: does not match inside a longer word', (id, make) => {
    expect(detected(`x${make()}`)).not.toContain(id);
  });

  it('keeps lookalikes that are not tokens', () => {
    expectUntouched('AKIA is the prefix of an AWS key id; AKIAshort is not one');
    expectUntouched('see ghp_short and gho_ prefixes in the GitHub docs');
    expectUntouched('glpat- tokens, xoxb- tokens, sk_live_ keys, and npm_ tokens');
    expectUntouched('sk-ant- is the Anthropic prefix; sk-proj- is the OpenAI one');
    expectUntouched('pk_live_' + randomish(24, 3).toLowerCase().slice(0, 4) + ' is publishable');
    expectUntouched('SKIP' + 'the twilio check: SKabc');
    expectUntouched('eyJ alone is just the start of base64 JSON');
    expectUntouched('xoxb-your-token-here');
  });

  it('openai-key: needs the T3BlbkFJ marker for legacy sk- keys', () => {
    expect(detected('sk-' + randomish(44, 4))).not.toContain('openai-key');
  });

  it('aws-secret-access-key: redacts the value of the assignment', () => {
    const secret = fake.awsSecret();
    const out = expectRedacted(
      `aws_secret_access_key = ${secret}`,
      secret,
      'aws-secret-access-key',
    );
    expect(out).toMatch(/^aws_secret_access_key = \[REDACTED:aws-secret-access-key:[0-9a-f]{8}\]$/);
    expectRedacted(`"SecretAccessKey": "${secret}"`, secret, 'aws-secret-access-key');
    expectUntouched('aws_secret_access_key = ${AWS_SECRET}');
  });

  it('slack-webhook: keeps the host and redacts the path', () => {
    const path = fake.slackWebhookPath();
    const out = expectRedacted(
      `curl https://hooks.slack.com/services/${path}`,
      path,
      'slack-webhook',
    );
    expect(out).toMatch(
      /^curl https:\/\/hooks\.slack\.com\/services\/\[REDACTED:slack-webhook:[0-9a-f]{8}\]$/,
    );
    expectUntouched('see https://hooks.slack.com/services for setup');
  });
});

describe('url-credentials', () => {
  it('redacts only the password', () => {
    const password = 'hunter2' + 'Zq9';
    const out = r.redactString(`postgres://app:${password}@db.internal:5432/main`).value;
    expect(out).toMatch(
      /^postgres:\/\/app:\[REDACTED:url-credentials:[0-9a-f]{8}\]@db\.internal:5432\/main$/,
    );
  });

  it('keeps URLs without a password and placeholder passwords', () => {
    expectUntouched('https://user@example.com/path and git@github.com:org/repo.git');
    expectUntouched('postgres://app:${DB_PASSWORD}@localhost/db');
    expectUntouched('redis://default:<password>@localhost:6379');
    expectUntouched('https://github.com/org/repo/blob/main/src/index.ts#L10');
  });
});

describe('authorization-header', () => {
  it('redacts Bearer, Basic, and Token credentials, also in curl -H', () => {
    const token = randomish(40, 41);
    const out = r.redactString(`curl -H "Authorization: Bearer ${token}" https://api.test`).value;
    expect(out).toMatch(
      /^curl -H "Authorization: Bearer \[REDACTED:authorization-header:[0-9a-f]{8}\]" https:\/\/api\.test$/,
    );
    const basic = Buffer.from('user:' + 'pa55' + 'word').toString('base64');
    expect(detected(`authorization: Basic ${basic}`)).toEqual(['authorization-header']);
    expect(detected(`"Authorization": "token ${token}"`)).toEqual(['authorization-header']);
  });

  it('keeps variable references and placeholders', () => {
    expectUntouched('curl -H "Authorization: Bearer $TOKEN" https://api.test');
    expectUntouched('Authorization: Bearer ${API_TOKEN}');
    expectUntouched('Authorization: Bearer <token>');
    expectUntouched('Authorization: Bearer YOUR_TOKEN_HERE');
  });
});

describe('env-assignment', () => {
  const value = 'Zx9' + 'Qw7' + 'Er5Ty';

  it.each([
    [`API_KEY=${value}`, 'API_KEY='],
    [`export DB_PASSWORD="${value}"`, 'export DB_PASSWORD="'],
    [`client_secret: ${value}`, 'client_secret: '],
    [`{"password": "${value}"}`, '{"password": "'],
    [`{\\"authToken\\":\\"${value}\\"}`, '{\\"authToken\\":\\"'],
    [`--token=${value}`, '--token='],
    [`mysql --password ${value} -h db`, 'mysql --password '],
    [`spring.datasource.password=${value}`, 'spring.datasource.password='],
    [`X-Api-Key: ${value}`, 'X-Api-Key: '],
    [`'secret' => '${value}'`, "'secret' => '"],
    [`?session_key=${value}&x=1`, '?session_key='],
  ])('redacts the value in %s', (text, prefix) => {
    const out = expectRedacted(text, value, 'env-assignment');
    expect(out.startsWith(prefix + '[REDACTED:env-assignment:')).toBe(true);
  });

  it('redacts a letters-only password in env-file syntax', () => {
    // Found by the redaction recall benchmark: random letters-only passwords were kept as identifiers.
    const value = ['tgHez', 'PGlML', 'eiZB'].join('');
    expectRedacted(`PASSWORD=${value}`, value, 'env-assignment');
    expectRedacted(`export DB_PASSWORD=${value}`, value, 'env-assignment');
  });

  it.each([
    'token = getToken',
    'password = readPassword',
    'secret: configSecret',
    'Password=hunter',
  ])('keeps code-like or lower-case-name assignment %s', (text) => {
    expectUntouched(text);
  });

  it('redacts a whole Cookie header value', () => {
    const out = r.redactString(`Cookie: sid=${value}; theme=dark\nnext`).value;
    expect(out).toMatch(/^Cookie: \[REDACTED:env-assignment:[0-9a-f]{8}\]\nnext$/);
  });

  it.each([
    'PASSWORD=',
    'TOKEN=abc',
    'TOKEN_LIMIT=1000',
    'MAX_TOKENS=4096',
    'API_KEY=${API_KEY}',
    'API_KEY=$API_KEY',
    'password: <your password>',
    'password=xxxxxxxx',
    'password: ********',
    'SECRET=changeme',
    'API_KEY=your-api-key-here',
    'token: example-token-123',
    'password = "dummy-value"',
    'auth_enabled: true',
    'secret: null',
    'password_file=/run/secrets/db',
    'TOKEN_URL=https://auth.example.test/token',
    'const token = getToken();',
    'password = req.body.password',
    'secret: process.env.SECRET',
    'token: string;',
    'if (password == "abc12345") return;',
    'All tests pass: 12 passed',
    'The auth: module handles login',
    'PWD=/Users/dev/projects/demo',
    'the author: Jane Doe',
    '"password": "Password must be at least 8 characters"',
    'tokenizer: cl100k_base',
  ])('keeps %s', (text) => {
    expectUntouched(text);
  });
});

describe('high-entropy', () => {
  it('redacts a standalone random token', () => {
    const token = randomish(40, 51);
    const out = expectRedacted(`value ${token} end`, token, 'high-entropy');
    expect(out).toMatch(/^value \[REDACTED:high-entropy:[0-9a-f]{8}\] end$/);
  });

  it('redacts the random part of NAME=token', () => {
    const token = randomish(40, 52);
    expect(r.redactString(`BUILD_ID=${token}`).value).toMatch(
      /^BUILD_ID=\[REDACTED:high-entropy:[0-9a-f]{8}\]$/,
    );
  });

  it.each([
    ['a git SHA', 'commit 8f14e45fceea167a5a36dedd4bea2543'.padEnd(47, '0')],
    ['a SHA-256 hex digest', 'sha256:' + 'ab12'.repeat(16)],
    ['a UUID', 'session 3f8a2b90-08fa-489f-87d6-7b5607f1099d'],
    ['an integrity hash', 'integrity sha512-' + randomish(86, 53) + '=='],
    ['a path', '/Users/dev/projects/demo/' + randomish(40, 54)],
    ['a file name', randomish(40, 55) + '.json'],
    ['a URL', 'https://cdn.test/' + randomish(40, 56)],
    ['a URL query', 'https://cdn.test/a?' + randomish(40, 57)],
    ['an identifier', 'handleUserAuthenticationCallbackForTesting'],
    ['snake case', 'test_redact_json_handles_nested_arrays_2'],
    ['a long run', randomish(600, 58)],
    ['a short token', randomish(31, 59)],
    ['a marker', '[REDACTED:high-entropy:0123abcd]'],
  ])('keeps %s', (_name, text) => {
    expectUntouched(text);
  });
});

describe('shannonEntropy', () => {
  it('computes bits per character', () => {
    expect(shannonEntropy('')).toBe(0);
    expect(shannonEntropy('aaaa')).toBe(0);
    expect(shannonEntropy('abab')).toBeCloseTo(1, 10);
    expect(shannonEntropy('abcd')).toBeCloseTo(2, 10);
    expect(shannonEntropy(randomish(512, 1))).toBeGreaterThan(5);
  });
});

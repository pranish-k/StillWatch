/**
 * Fake secrets for tests, built at runtime by concatenation so secret
 * scanners never see a literal real-looking secret in the repository.
 */
import { createRedactor, type Redactor } from '../src/index';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Deterministic pseudo-random alphanumeric string. */
export function randomish(length: number, seed = 7): string {
  let state = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += ALPHABET.charAt((state >>> 8) % ALPHABET.length);
  }
  return out;
}

/** A 32-byte base64url key, like the one in config. */
export const KEY = Buffer.alloc(32, 7).toString('base64url');

export function redactor(key: string | Uint8Array = KEY): Redactor {
  return createRedactor({ fingerprintKey: key });
}

export const fake = {
  awsAccessKeyId: () => 'AK' + 'IA' + 'Q7Z3'.repeat(4),
  awsSecret: () => randomish(18, 3) + '/' + randomish(21, 4),
  githubClassic: () => 'gh' + 'p_' + randomish(36, 5),
  githubPat: () => 'github' + '_pat_' + randomish(22, 6) + '_' + randomish(59, 7),
  gitlab: () => 'gl' + 'pat-' + randomish(20, 8),
  slackToken: () => 'xo' + 'xb-' + '1234567890' + '-' + '9876543210' + '-' + randomish(24, 9),
  slackWebhookPath: () =>
    'T' + randomish(8, 10) + '/B' + randomish(8, 11) + '/' + randomish(24, 12),
  stripe: () => 'sk' + '_live_' + randomish(24, 13),
  anthropic: () => 'sk-' + 'ant-' + 'api03-' + randomish(93, 14) + 'AA',
  openaiProject: () => 'sk-' + 'proj-' + randomish(48, 15),
  openaiLegacy: () => 'sk-' + randomish(20, 16) + 'T3Blbk' + 'FJ' + randomish(20, 17),
  google: () => 'AI' + 'za' + 'Sy' + randomish(33, 18),
  npm: () => 'np' + 'm_' + randomish(36, 19),
  pypi: () => 'py' + 'pi-' + 'AgEIcHlwaS5vcmc' + randomish(60, 20),
  sendgrid: () => 'S' + 'G.' + randomish(22, 21) + '.' + randomish(43, 22),
  twilio: () => 'S' + 'K' + '0123456789abcdef'.repeat(2),
  shopify: () => 'sh' + 'pat_' + 'fedcba9876543210'.repeat(2),
  jwt: () =>
    'ey' +
    'JhbGciOiJIUzI1NiJ9' +
    '.' +
    'ey' +
    'JzdWIiOiIxMjM0NTY3ODkwIn0' +
    '.' +
    randomish(43, 23),
  privateKey: (type = 'RSA ') =>
    '-----' +
    'BEGIN ' +
    type +
    'PRIVATE KEY-----\n' +
    randomish(64, 24) +
    '\n' +
    randomish(64, 25) +
    '\n' +
    randomish(20, 26) +
    '==\n-----END ' +
    type +
    'PRIVATE KEY-----',
};

/**
 * Decides whether a key name (env var, YAML key, JSON key, CLI flag) names a
 * secret, and whether a value assigned to it is a real value or a placeholder.
 */

/** Single name parts that name a secret (compared lowercase, plural `s` removed). */
const SECRET_PARTS = new Set([
  'password',
  'passwd',
  'pwd',
  'pass',
  'passphrase',
  'secret',
  'token',
  'apikey',
  'accesskey',
  'privatekey',
  'clientsecret',
  'sessionkey',
  'auth',
  'authorization',
  'credential',
  'cookie',
  'signature',
]);

/** Adjacent part pairs that name a secret when joined, e.g. api + key. */
const SECRET_PAIRS = new Set(['apikey', 'accesskey', 'privatekey', 'clientsecret', 'sessionkey']);

/**
 * A final part that describes a setting about the secret rather than the
 * secret itself, e.g. TOKEN_LIMIT, password_file, auth_url.
 */
const DESCRIPTOR_PARTS = new Set([
  'type',
  'kind',
  'limit',
  'count',
  'max',
  'min',
  'length',
  'len',
  'size',
  'ttl',
  'timeout',
  'expiry',
  'expire',
  'expiration',
  'exp',
  'url',
  'uri',
  'endpoint',
  'host',
  'hostname',
  'domain',
  'path',
  'file',
  'filename',
  'dir',
  'name',
  'id',
  'mode',
  'method',
  'scheme',
  'format',
  'policy',
  'provider',
  'enabled',
  'disabled',
  'required',
  'version',
  'field',
  'prefix',
  'suffix',
  'env',
  'var',
  'location',
  'region',
  'stdin',
  'hint',
  'label',
  'placeholder',
  'message',
  'error',
  'help',
  'description',
  'desc',
  'title',
  'text',
  'prompt',
  'algorithm',
  'alg',
  'rotation',
  'strategy',
  'budget',
  'usage',
  'used',
  'remaining',
  'window',
  'ms',
  'seconds',
]);

const MAX_NAME_LENGTH = 128;

/** Splits a key name into lowercase parts on separators and camelCase boundaries. */
export function nameParts(name: string): string[] {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2');
  const parts: string[] = [];
  for (const raw of spaced.split(/[^A-Za-z0-9]+/)) {
    if (raw === '') continue;
    let part = raw.toLowerCase().replace(/\d+$/, '');
    if (part.length > 4 && part.endsWith('s') && SECRET_PARTS.has(part.slice(0, -1))) {
      part = part.slice(0, -1);
    }
    if (part !== '') parts.push(part);
  }
  return parts;
}

/** True when the key name looks like it holds a secret. Case-insensitive. */
export function isSecretName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return false;
  const parts = nameParts(name);
  const last = parts.at(-1);
  if (last === undefined) return false;
  let secret = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? '';
    const next = parts[i + 1];
    if (SECRET_PARTS.has(part) || (next !== undefined && SECRET_PAIRS.has(part + next))) {
      secret = true;
      break;
    }
  }
  if (!secret) return false;
  // TOKEN_LIMIT, password_file: a descriptor at the end, unless the last part is itself secret.
  if (DESCRIPTOR_PARTS.has(last) && !SECRET_PARTS.has(last)) return false;
  return true;
}

const PLACEHOLDER_WORDS = new Set([
  'true',
  'false',
  'null',
  'nil',
  'none',
  'undefined',
  'changeme',
  'password',
  'passwd',
  'secret',
  'token',
  'redacted',
  'placeholder',
  'example',
  'dummy',
  'sample',
  'string',
  'required',
  'optional',
  'hidden',
  'masked',
]);

const PLACEHOLDER_SUBSTRINGS = ['changeme', 'example', 'dummy', 'placeholder', '[redacted:'];
const NUMERIC_CONFIG = /^\d+(?:[._,]\d+)*(?:ms|s|m|h|d|k|kb|mb|gb|%)?$/i;
const FILLER = /^[xX*.•_-]+$/;

export type PlaceholderOptions = {
  /** Values shorter than this are treated as placeholders. */
  minLength: number;
};

/**
 * True for values that are not real secrets: empty or short values, numbers
 * and numeric config, variable references (${VAR}, $VAR, %VAR%, {{ var }}),
 * <...>, xxx, ***, changeme, your-..., example, dummy, booleans, null, and
 * existing redaction markers.
 */
export function isPlaceholderValue(value: string, options: PlaceholderOptions): boolean {
  const v = value.trim();
  if (v.length < options.minLength || v.length === 0) return true;
  const first = v.charAt(0);
  if (first === '$' || first === '<' || first === '%') return true;
  if (v.startsWith('{{')) return true;
  if (first === '[' && v.endsWith(']')) return true;
  if (FILLER.test(v) || NUMERIC_CONFIG.test(v)) return true;
  const lower = v.toLowerCase();
  if (PLACEHOLDER_WORDS.has(lower)) return true;
  if (lower.startsWith('your')) return true;
  for (const part of PLACEHOLDER_SUBSTRINGS) if (lower.includes(part)) return true;
  return distinctCharCount(v, 3) < 3;
}

/** True for prose rather than a secret: two or more whitespace characters. */
export function isProse(value: string): boolean {
  let spaces = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 32 || (c >= 9 && c <= 13)) {
      spaces++;
      if (spaces >= 2) return true;
    }
  }
  return false;
}

function distinctCharCount(text: string, stopAt: number): number {
  const seen = new Set<string>();
  for (const ch of text) {
    seen.add(ch);
    if (seen.size >= stopAt) break;
  }
  return seen.size;
}

/**
 * Identifier helpers. These run in Node and in the browser, so they only use
 * the global Web Crypto `getRandomValues` (Node 19+ and every browser).
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

type WebCrypto = { getRandomValues<T extends Uint8Array>(array: T): T };

function randomBytes(length: number): Uint8Array {
  const crypto = (globalThis as unknown as { crypto: WebCrypto }).crypto;
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Returns a 26 character, time-sortable identifier (ULID layout):
 * 48 bits of millisecond time followed by 80 random bits, Crockford base32.
 * Identifiers created in the same millisecond are unique but not ordered.
 */
export function newId(now: number = Date.now()): string {
  let time = Math.max(0, Math.floor(now));
  const timeChars: string[] = new Array<string>(10);
  for (let i = 9; i >= 0; i--) {
    timeChars[i] = CROCKFORD.charAt(time % 32);
    time = Math.floor(time / 32);
  }
  let randomChars = '';
  for (const byte of randomBytes(16)) randomChars += CROCKFORD.charAt(byte % 32);
  return timeChars.join('') + randomChars;
}

/** Base64url without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out +=
      BASE64URL.charAt((n >> 18) & 63) +
      BASE64URL.charAt((n >> 12) & 63) +
      BASE64URL.charAt((n >> 6) & 63) +
      BASE64URL.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += BASE64URL.charAt((n >> 18) & 63) + BASE64URL.charAt((n >> 12) & 63);
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out +=
      BASE64URL.charAt((n >> 18) & 63) +
      BASE64URL.charAt((n >> 12) & 63) +
      BASE64URL.charAt((n >> 6) & 63);
  }
  return out;
}

/** Random URL-safe token (base64url) with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

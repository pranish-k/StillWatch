import { createHmac } from 'node:crypto';

/** Computes the 8-hex-character fingerprint of one secret. */
export type Fingerprinter = (secret: string) => string;

const BASE64URL = /^[A-Za-z0-9_-]*={0,2}$/;

/**
 * Decodes the fingerprint key. A string is base64url (as stored in config);
 * bytes are used as is. Throws on an empty or malformed key, because a weak
 * key would make fingerprints guessable.
 */
export function decodeFingerprintKey(key: string | Uint8Array): Buffer {
  let bytes: Buffer;
  if (typeof key === 'string') {
    if (!BASE64URL.test(key)) {
      throw new TypeError('fingerprintKey must be a base64url string');
    }
    bytes = Buffer.from(key, 'base64url');
  } else {
    bytes = Buffer.from(key);
  }
  if (bytes.length === 0) throw new TypeError('fingerprintKey must not be empty');
  return bytes;
}

/** Builds a fingerprinter: first 8 hex characters of HMAC-SHA256(key, secret). */
export function createFingerprinter(key: string | Uint8Array): Fingerprinter {
  const bytes = decodeFingerprintKey(key);
  return (secret) => createHmac('sha256', bytes).update(secret, 'utf8').digest('hex').slice(0, 8);
}

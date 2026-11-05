/**
 * @stillwatch/redaction
 *
 * Removes secrets before anything is stored (ADR-009) and minimizes stored
 * data (truncation). A secret is replaced in place by
 * `redactionMarker(detector, fingerprint)` from @stillwatch/schema, where the
 * fingerprint is HMAC-SHA256(fingerprintKey, secret) so equal secrets can be
 * correlated without being stored.
 *
 * Requirements:
 * - Every regular expression must run in linear time on untrusted input (no
 *   nested or overlapping quantifiers). Inputs are capped at LIMITS.hardStringCap.
 * - Prefer missing an exotic secret over destroying normal text: git SHAs,
 *   UUIDs, integrity hashes, and file paths must survive.
 * - Tests must never contain a literal real-looking secret. Build fake secrets
 *   at runtime by concatenation so secret scanners do not flag the repository.
 *
 * Public API contract. Signatures are fixed; implementations replace the stubs.
 */
import type { JsonValue, Redaction } from '@stillwatch/schema';

export type DetectorInfo = {
  /** Lowercase kebab-case id used in markers, e.g. "aws-access-key-id". */
  id: string;
  description: string;
  kind: 'pattern' | 'assignment' | 'entropy' | 'structure';
};

/** All detectors, in the order they run. */
export const DETECTORS: readonly DetectorInfo[] = [];

export type RedactorOptions = {
  /** HMAC key for fingerprints: raw bytes, or a base64url string (as stored in config). */
  fingerprintKey: string | Uint8Array;
};

export type RedactResult<T> = { value: T; redactions: Redaction[] };

export type Redactor = {
  /** Redacts secrets in one string. `pointer` is recorded on each `Redaction` (default ""). */
  redactString(text: string, pointer?: string): RedactResult<string>;
  /**
   * Deeply redacts every string in a JSON value. Object keys are kept, but a
   * value whose key names a secret (password, token, api_key, secret, ...)
   * is redacted whole. Pointers are RFC 6901, prefixed with `basePointer`.
   */
  redactJson<T extends JsonValue>(value: T, basePointer?: string): RedactResult<T>;
};

export function createRedactor(_options: RedactorOptions): Redactor {
  throw new Error('not implemented: createRedactor');
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(_text: string): number {
  throw new Error('not implemented: shannonEntropy');
}

export type TruncateOptions = {
  /** Default cap for strings. */
  maxString: number;
  /** Arrays are cut to this many items (no marker item, so element types stay intact). */
  maxArrayItems: number;
  /** Values nested deeper are replaced by the string "[depth limit]". */
  maxDepth: number;
  /** Cap for the JSON-serialized size of the whole value, in UTF-8 bytes. */
  maxTotalBytes: number;
  /** Per-subtree string caps, matched by JSON pointer prefix (longest prefix wins). */
  overrides?: { pointerPrefix: string; maxString: number }[];
};

export type TruncateResult<T> = {
  value: T;
  /** JSON pointers of strings or arrays that were cut. */
  truncated: string[];
};

/**
 * Shortens a JSON value for storage. Strings over their cap keep their head
 * and end with `truncationMarker(n)`. Must run after redaction.
 */
export function truncateJson<T extends JsonValue>(
  _value: T,
  _options: TruncateOptions,
): TruncateResult<T> {
  throw new Error('not implemented: truncateJson');
}

/** Caps one string, appending `truncationMarker(n)` when cut. */
export function capString(_text: string, _max: number): string {
  throw new Error('not implemented: capString');
}

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
import { DETECTOR_INFOS } from './detectors';
import { shannonEntropy as entropy } from './detectors/entropy';
import { buildRedactor } from './redactor';
import { capStringImpl, truncateJsonImpl } from './truncate';

export type DetectorInfo = {
  /** Lowercase kebab-case id used in markers, e.g. "aws-access-key-id". */
  id: string;
  description: string;
  kind: 'pattern' | 'assignment' | 'entropy' | 'structure';
};

/**
 * All detectors, in the order they run. String detectors run first, in this
 * order, on every string; `secret-field` runs last and only in `redactJson`.
 */
export const DETECTORS: readonly DetectorInfo[] = DETECTOR_INFOS;

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

/**
 * Creates a redactor. Throws a TypeError when the fingerprint key is empty or
 * not base64url.
 */
export function createRedactor(options: RedactorOptions): Redactor {
  return buildRedactor(options);
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(text: string): number {
  return entropy(text);
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
 *
 * Containers at depth `maxDepth` or deeper (the root is depth 0) become
 * "[depth limit]", matching `toJsonValue`. Overrides match a pointer equal to
 * the prefix or below it. If the serialized value is still over
 * `maxTotalBytes`, the caps of the largest strings are halved repeatedly
 * (bounded). `truncated` lists cut strings and arrays and depth-limited values.
 */
export function truncateJson<T extends JsonValue>(
  value: T,
  options: TruncateOptions,
): TruncateResult<T> {
  return truncateJsonImpl(value, options);
}

/** Caps one string, appending `truncationMarker(n)` when cut. */
export function capString(text: string, max: number): string {
  return capStringImpl(text, max);
}

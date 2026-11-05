/**
 * Redaction metadata and the marker format shared by `@stillwatch/redaction`
 * (which writes markers) and `@stillwatch/facts` (which reads them).
 *
 * A redacted secret is replaced in place by `[REDACTED:<detector>:<fp>]`,
 * where `<fp>` is the first 8 hex characters of HMAC-SHA256(localKey, secret).
 * Equal fingerprints mean the same secret, without storing the secret.
 */

export type Redaction = {
  /** RFC 6901 JSON pointer to the string that held the secret, within the stored event. */
  pointer: string;
  /** Detector id, e.g. "aws-access-key-id", "private-key", "env-assignment", "high-entropy". */
  detector: string;
  /** 8 lowercase hex characters. */
  fingerprint: string;
  /** Number of matches for this detector and fingerprint in that string. */
  count: number;
};

export function redactionMarker(detector: string, fingerprint: string): string {
  return `[REDACTED:${detector}:${fingerprint.slice(0, 8)}]`;
}

export type RedactionMarker = { detector: string; fingerprint: string; index: number };

/** Finds redaction markers in text. Linear time. */
export function findRedactionMarkers(text: string): RedactionMarker[] {
  const out: RedactionMarker[] = [];
  const re = /\[REDACTED:([a-z0-9-]{1,40}):([0-9a-f]{8})\]/g;
  for (const match of text.matchAll(re)) {
    const detector = match[1];
    const fingerprint = match[2];
    if (detector !== undefined && fingerprint !== undefined) {
      out.push({ detector, fingerprint, index: match.index });
    }
  }
  return out;
}

/** Marker appended to a string that was cut for storage. */
export function truncationMarker(removedChars: number): string {
  return `[TRUNCATED:${removedChars} chars]`;
}

export function isTruncated(text: string): boolean {
  return /\[TRUNCATED:\d+ chars\]$/.test(text);
}

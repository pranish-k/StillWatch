/**
 * Splits text into plain spans and Stillwatch markers, so the UI can
 * highlight `[REDACTED:<detector>:<fp>]` and `[TRUNCATED:<n> chars]` without
 * ever interpreting the text as markup. Linear time.
 */

export type TextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'redacted'; text: string; detector: string; fingerprint: string }
  | { kind: 'truncated'; text: string; removed: number };

const MARKER_RE = /\[REDACTED:([a-z0-9-]{1,40}):([0-9a-f]{8})\]|\[TRUNCATED:(\d{1,12}) chars\]/g;

export function parseMarkers(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKER_RE)) {
    const start = match.index;
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    const [whole, detector, fingerprint, removed] = match;
    if (detector !== undefined && fingerprint !== undefined) {
      out.push({ kind: 'redacted', text: whole, detector, fingerprint });
    } else {
      out.push({ kind: 'truncated', text: whole, removed: Number(removed ?? 0) });
    }
    last = start + whole.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

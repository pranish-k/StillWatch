/**
 * Runs the string detectors over one string and records redactions.
 */
import {
  findRedactionMarkers,
  LIMITS,
  redactionMarker,
  truncationMarker,
  type Redaction,
} from '@stillwatch/schema';
import type { StringDetector } from './detectors/types';
import type { Fingerprinter } from './fingerprint';
import { safeCutIndex } from './text';

/** Collects one `Redaction` per (pointer, detector, fingerprint), counting repeats. */
export class RedactionLog {
  private readonly entries = new Map<string, Redaction>();

  add(pointer: string, detector: string, fingerprint: string): void {
    const key = `${pointer}\u0000${detector}\u0000${fingerprint}`;
    const existing = this.entries.get(key);
    if (existing) existing.count++;
    else this.entries.set(key, { pointer, detector, fingerprint, count: 1 });
  }

  /** Adds every record of another log, keeping counts. */
  merge(other: RedactionLog): void {
    for (const r of other.list()) {
      const key = `${r.pointer}\u0000${r.detector}\u0000${r.fingerprint}`;
      const existing = this.entries.get(key);
      if (existing) existing.count += r.count;
      else this.entries.set(key, { ...r });
    }
  }

  list(): Redaction[] {
    return [...this.entries.values()];
  }
}

type Range = { start: number; end: number };

function markerRanges(text: string): Range[] {
  if (!text.includes('[REDACTED:')) return [];
  return findRedactionMarkers(text).map((m) => ({
    start: m.index,
    end: m.index + redactionMarker(m.detector, m.fingerprint).length,
  }));
}

/**
 * Replaces one detector's matches with markers. Matches that overlap an
 * existing marker are skipped, which keeps redaction idempotent.
 */
function applyDetector(
  text: string,
  lower: string,
  detector: StringDetector,
  fingerprint: Fingerprinter,
  record: (detector: string, fingerprint: string) => void,
): string {
  if (!detector.applies(text, lower)) return text;
  const spans = detector.find(text);
  if (spans.length === 0) return text;
  const markers = markerRanges(text);
  const parts: string[] = [];
  let last = 0;
  let m = 0;
  for (const span of spans) {
    if (span.start < last || span.end <= span.start) continue;
    while (m < markers.length && (markers[m]?.end ?? 0) <= span.start) m++;
    const marker = markers[m];
    if (marker && marker.start < span.end) continue;
    const fp = fingerprint(text.slice(span.start, span.end));
    parts.push(text.slice(last, span.start), redactionMarker(detector.info.id, fp));
    record(detector.info.id, fp);
    last = span.end;
  }
  if (parts.length === 0) return text;
  parts.push(text.slice(last));
  return parts.join('');
}

/**
 * Redacts one string with the given detectors. Strings longer than
 * `LIMITS.hardStringCap` are cut first (to bound the work) and end with a
 * truncation marker.
 */
export function redactText(
  input: string,
  pointer: string,
  detectors: readonly StringDetector[],
  fingerprint: Fingerprinter,
  log: RedactionLog,
): string {
  let text = input;
  let removed = 0;
  if (text.length > LIMITS.hardStringCap) {
    const cut = safeCutIndex(text, LIMITS.hardStringCap);
    removed = text.length - cut;
    text = text.slice(0, cut);
  }
  const lower = text.toLowerCase();
  const record = (detector: string, fp: string) => {
    log.add(pointer, detector, fp);
  };
  for (const detector of detectors) {
    text = applyDetector(text, lower, detector, fingerprint, record);
  }
  return removed > 0 ? text + truncationMarker(removed) : text;
}

/** True when the whole string is exactly one redaction marker. */
export function isSingleMarker(text: string): boolean {
  if (!text.startsWith('[REDACTED:') || !text.endsWith(']')) return false;
  const markers = findRedactionMarkers(text);
  const only = markers.length === 1 ? markers[0] : undefined;
  return (
    only?.index === 0 && redactionMarker(only.detector, only.fingerprint).length === text.length
  );
}

/**
 * Small text helpers shared by fact extraction: capping text without
 * splitting a redaction marker or a surrogate pair, and walking the strings
 * inside a JSON value with a budget.
 */
import { findRedactionMarkers, redactionMarker, type JsonValue } from '@stillwatch/schema';

/** Longest possible redaction marker, so a scan window always contains a whole one. */
const MAX_MARKER_LENGTH = '[REDACTED:'.length + 40 + 1 + 8 + 1;

/**
 * Returns at most `max` characters from the start of `text`. The cut moves
 * back so it never splits a surrogate pair or a redaction marker.
 */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = Math.max(0, max);
  if (cut > 0 && isHighSurrogate(text.charCodeAt(cut - 1))) cut -= 1;
  const windowStart = Math.max(0, cut - MAX_MARKER_LENGTH);
  const window = text.slice(windowStart, cut + MAX_MARKER_LENGTH);
  for (const m of findRedactionMarkers(window)) {
    const start = windowStart + m.index;
    const end = start + redactionMarker(m.detector, m.fingerprint).length;
    if (start < cut && end > cut) {
      cut = start;
      break;
    }
  }
  return text.slice(0, cut);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export type StringVisit = (value: string, pointer: string) => void;

/**
 * Calls `visit` for each string in `value`, depth first, until `budget`
 * characters have been visited. Object keys are not visited. Returns false
 * when the budget ran out before the walk finished.
 */
export function forEachString(value: JsonValue, budget: number, visit: StringVisit): boolean {
  let left = budget;
  const stack: { value: JsonValue; pointer: string }[] = [{ value, pointer: '' }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    const v = item.value;
    if (typeof v === 'string') {
      if (left <= 0) return false;
      const text = v.length > left ? capText(v, left) : v;
      left -= v.length;
      visit(text, item.pointer);
    } else if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        stack.push({ value: v[i] ?? null, pointer: `${item.pointer}/${i}` });
      }
    } else if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v);
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i] ?? '';
        stack.push({ value: v[key] ?? null, pointer: `${item.pointer}/${escapePointer(key)}` });
      }
    }
  }
  return true;
}

function escapePointer(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

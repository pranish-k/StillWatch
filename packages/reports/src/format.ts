/**
 * Deterministic formatting for counts, lists, times, and durations.
 * Nothing here depends on the locale, the time zone, or the clock.
 */

/** Singular or plural form of a noun for a count. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

/** Integer with thousands separators, e.g. "12,345". */
export function formatCount(count: number): string {
  const n = Math.trunc(count);
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return sign + out;
}

/** "1 file", "12 files", "1,204 commands". */
export function countOf(count: number, singular: string, pluralForm?: string): string {
  return `${formatCount(count)} ${plural(count, singular, pluralForm)}`;
}

/** English list: "a", "a and b", "a, b, and c". */
export function joinList(items: readonly string[]): string {
  const [first, second] = items;
  if (first === undefined) return '';
  if (second === undefined) return first;
  if (items.length === 2) return `${first} and ${second}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1] ?? ''}`;
}

/** Upper-cases the first character. */
export function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** Code unit order comparison: deterministic in every locale. */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** "2026-11-04 23:51 UTC", or "unknown" for an invalid time. */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) return 'unknown';
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  if (!Number.isFinite(year)) return 'unknown';
  return `${String(year)}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(
    date.getUTCHours(),
  )}:${pad2(date.getUTCMinutes())} UTC`;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "under a second", "45 seconds", "12 minutes", "1 hour 5 minutes", "2 days 3 hours". */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'unknown';
  if (ms < SECOND) return 'under a second';
  if (ms < MINUTE) return countOf(Math.floor(ms / SECOND), 'second');
  if (ms < HOUR) return countOf(Math.floor(ms / MINUTE), 'minute');
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return minutes === 0
      ? countOf(hours, 'hour')
      : `${countOf(hours, 'hour')} ${countOf(minutes, 'minute')}`;
  }
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  return hours === 0 ? countOf(days, 'day') : `${countOf(days, 'day')} ${countOf(hours, 'hour')}`;
}

/** First characters of an id, for display ("3f8a2b90"). */
export function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) : id;
}

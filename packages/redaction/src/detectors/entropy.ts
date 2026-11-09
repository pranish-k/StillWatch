/**
 * High-entropy tokens: standalone runs of base64 or base64url characters that
 * look random. This is the last line of defense, so it is conservative:
 * anything that looks like a path, URL, file name, hash, or UUID survives.
 */
import { isAlnumCode } from '../text';
import type { Span, StringDetector } from './types';

const MIN_LENGTH = 32;
const MAX_LENGTH = 512;
const MIN_ENTROPY = 4.0;
const HEXISH = /^[0-9a-fA-F_-]+$/;
const INTEGRITY_PREFIX = /^sha(?:1|224|256|384|512)[-=]/i;
const DIGEST_CONTEXT = /sha(?:1|224|256|384|512):$/i;

/** Shannon entropy in bits per character (per UTF-16 code unit). */
export function shannonEntropy(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<number, number>();
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Characters of a run: the token alphabet plus `.`, `/`, `%`, `~`, which disqualify it. */
function isRunCode(code: number): boolean {
  return (
    isAlnumCode(code) ||
    code === 43 || // +
    code === 47 || // /
    code === 61 || // =
    code === 95 || // _
    code === 45 || // -
    code === 46 || // .
    code === 37 || // %
    code === 126 // ~
  );
}

function hasDisqualifier(run: string): boolean {
  return run.includes('/') || run.includes('.') || run.includes('%') || run.includes('~');
}

/** True when a candidate token looks like a random secret. */
export function looksRandom(token: string): boolean {
  if (token.length < MIN_LENGTH || token.length > MAX_LENGTH) return false;
  if (HEXISH.test(token)) return false;
  let upper = false;
  let lower = false;
  let digit = false;
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    if (c >= 65 && c <= 90) upper = true;
    else if (c >= 97 && c <= 122) lower = true;
    else if (c >= 48 && c <= 57) digit = true;
  }
  if (!upper || !lower || !digit) return false;
  return shannonEntropy(token) >= MIN_ENTROPY;
}

/** Splits a run on inner `=` (as in NAME=value), keeping trailing padding on the last piece. */
function pieces(run: string, offset: number): Span[] {
  let last = run.length;
  while (last > 0 && run.charCodeAt(last - 1) === 61) last--;
  const out: Span[] = [];
  let start = 0;
  for (let i = 0; i <= last; i++) {
    if (i === last || run.charCodeAt(i) === 61) {
      if (i > start)
        out.push({ start: offset + start, end: offset + (i === last ? run.length : i) });
      start = i + 1;
    }
  }
  return out;
}

function findHighEntropy(text: string): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < text.length) {
    if (!isRunCode(text.charCodeAt(i))) {
      i++;
      continue;
    }
    const start = i;
    while (i < text.length && isRunCode(text.charCodeAt(i))) i++;
    const length = i - start;
    if (length < MIN_LENGTH) continue;
    const prev = start > 0 ? text.charAt(start - 1) : '';
    if (prev === '?' || prev === '&' || prev === '#' || prev === '@') continue;
    const run = text.slice(start, i);
    if (hasDisqualifier(run) || INTEGRITY_PREFIX.test(run)) continue;
    if (DIGEST_CONTEXT.test(text.slice(Math.max(0, start - 7), start))) continue;
    for (const piece of pieces(run, start)) {
      if (looksRandom(text.slice(piece.start, piece.end))) spans.push(piece);
    }
  }
  return spans;
}

/** Standalone random-looking tokens of 32 to 512 characters. */
export const highEntropy: StringDetector = {
  info: {
    id: 'high-entropy',
    description: 'Standalone random-looking token (32-512 base64 characters, high entropy)',
    kind: 'entropy',
  },
  applies: (text) => text.length >= MIN_LENGTH,
  find: findHighEntropy,
};

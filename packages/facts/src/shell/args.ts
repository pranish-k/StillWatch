/**
 * Generic command-line option parsing for program families. It understands
 * short clusters (`-sSLo file`), attached values (`-ofile`, `--out=file`),
 * long options that take the next word, and `--`.
 */
import { deriveWord, type Word } from './types';

export type OptSpec = {
  /** Short option letters that take a value. */
  short?: string;
  /** Long options (with leading dashes) that take the next word as value. */
  long?: readonly string[];
};

export type ArgItem =
  { kind: 'opt'; name: string; value: Word | null } | { kind: 'arg'; word: Word };

/** Longest short-option cluster that is examined. */
const MAX_CLUSTER = 32;

export function parseArgs(words: readonly Word[], spec: OptSpec = {}): ArgItem[] {
  const short = spec.short ?? '';
  const long = spec.long ?? [];
  const out: ArgItem[] = [];
  let operandsOnly = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === undefined) continue;
    const v = w.value;
    if (operandsOnly || v === '-' || !v.startsWith('-')) {
      out.push({ kind: 'arg', word: w });
      continue;
    }
    if (v === '--') {
      operandsOnly = true;
      continue;
    }
    if (v.startsWith('--')) {
      const eq = v.indexOf('=');
      if (eq !== -1) {
        out.push({ kind: 'opt', name: v.slice(0, eq), value: deriveWord(w, v.slice(eq + 1)) });
      } else if (long.includes(v)) {
        const next = words[i + 1] ?? null;
        out.push({ kind: 'opt', name: v, value: next });
        if (next) i++;
      } else {
        out.push({ kind: 'opt', name: v, value: null });
      }
      continue;
    }
    const end = Math.min(v.length, MAX_CLUSTER);
    for (let j = 1; j < end; j++) {
      const ch = v.charAt(j);
      if (short.includes(ch)) {
        if (j < v.length - 1) {
          out.push({ kind: 'opt', name: `-${ch}`, value: deriveWord(w, v.slice(j + 1)) });
        } else {
          const next = words[i + 1] ?? null;
          out.push({ kind: 'opt', name: `-${ch}`, value: next });
          if (next) i++;
        }
        break;
      }
      out.push({ kind: 'opt', name: `-${ch}`, value: null });
    }
  }
  return out;
}

export function operandsOf(items: readonly ArgItem[]): Word[] {
  const out: Word[] = [];
  for (const item of items) if (item.kind === 'arg') out.push(item.word);
  return out;
}

export function hasOpt(items: readonly ArgItem[], ...names: string[]): boolean {
  return items.some((item) => item.kind === 'opt' && names.includes(item.name));
}

/** Values of every occurrence of the named options. */
export function optValues(items: readonly ArgItem[], ...names: string[]): Word[] {
  const out: Word[] = [];
  for (const item of items) {
    if (item.kind === 'opt' && item.value !== null && names.includes(item.name)) {
      out.push(item.value);
    }
  }
  return out;
}

/** Value of the last occurrence of the named options, or null. */
export function optValue(items: readonly ArgItem[], ...names: string[]): Word | null {
  return optValues(items, ...names).at(-1) ?? null;
}

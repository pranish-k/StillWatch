/**
 * Defensive accessors for untrusted, already-parsed JSON.
 * Hook payloads, transcripts, and settings files are all untrusted input:
 * never cast them, read each field through these helpers.
 */
import { isRecord } from './json';

export function getString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' ? value : null;
}

export function getNumber(obj: Record<string, unknown>, key: string): number | null {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getBoolean(obj: Record<string, unknown>, key: string): boolean | null {
  const value = obj[key];
  return typeof value === 'boolean' ? value : null;
}

export function getRecord(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = obj[key];
  return isRecord(value) ? value : null;
}

export function getArray(obj: Record<string, unknown>, key: string): unknown[] | null {
  const value = obj[key];
  return Array.isArray(value) ? value : null;
}

/** Returns only the string items of an array field, or `[]` when absent. */
export function getStringArray(obj: Record<string, unknown>, key: string): string[] {
  const value = getArray(obj, key);
  if (!value) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** Parses JSON text, returning `null` instead of throwing. */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

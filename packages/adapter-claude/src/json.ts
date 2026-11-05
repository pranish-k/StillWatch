/**
 * Small typed accessors over already-converted JSON (`toJsonValue` output).
 * Hook payloads are untrusted, so every read checks the type and gives
 * `null` (or an empty value) instead of trusting the shape.
 */
import type { JsonObject, JsonValue } from '@stillwatch/schema';

/** The value as a JSON object, or null for anything else (including arrays). */
export function asObject(value: JsonValue | undefined): JsonObject | null {
  if (value === undefined || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) return null;
  return value;
}

/** The value as a JSON array, or null. */
export function asArray(value: JsonValue | undefined): JsonValue[] | null {
  return Array.isArray(value) ? value : null;
}

/** A string field, or null when absent or not a string. */
export function str(obj: JsonObject | null, key: string): string | null {
  if (obj === null) return null;
  const value = obj[key];
  return typeof value === 'string' ? value : null;
}

/** A boolean field, or null when absent or not a boolean. */
export function bool(obj: JsonObject | null, key: string): boolean | null {
  if (obj === null) return null;
  const value = obj[key];
  return typeof value === 'boolean' ? value : null;
}

/** A finite number field, or null. */
export function num(obj: JsonObject | null, key: string): number | null {
  if (obj === null) return null;
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** String items of an array field, at most `max` of them; `[]` when absent. */
export function strList(obj: JsonObject | null, key: string, max: number): string[] {
  const list = obj === null ? null : asArray(obj[key]);
  if (list === null) return [];
  const out: string[] = [];
  for (const item of list) {
    if (out.length >= max) break;
    if (typeof item === 'string') out.push(item);
  }
  return out;
}

const MAX_ID_LENGTH = 256;

/**
 * An identifier (session, agent, prompt, tool use) is a non-empty string of at
 * most 256 characters without control characters. Anything else is rejected,
 * because identifiers become database keys and display labels.
 */
export function cleanId(value: JsonValue | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) return null;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return null;
  }
  return value;
}

/**
 * The first `max` UTF-16 code units of `text`, never splitting a surrogate
 * pair (a cut that would leave a lone high surrogate drops it).
 */
export function sliceChars(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 0) return '';
  const code = text.charCodeAt(max - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
  return text.slice(0, end);
}

/**
 * JSON serialization that stops once `max` characters are produced, so a
 * preview of a huge value costs O(max) instead of O(size).
 */
export function boundedJson(value: JsonValue, max: number): string {
  const parts: string[] = [];
  let length = 0;
  const push = (piece: string): boolean => {
    parts.push(piece);
    length += piece.length;
    return length < max;
  };
  const walk = (node: JsonValue): boolean => {
    if (node === null || typeof node !== 'object') {
      const text = typeof node === 'string' ? JSON.stringify(sliceChars(node, max)) : String(node);
      return push(text);
    }
    if (Array.isArray(node)) {
      if (!push('[')) return false;
      for (let i = 0; i < node.length; i++) {
        if (i > 0 && !push(',')) return false;
        const item = node[i];
        if (item !== undefined && !walk(item)) return false;
      }
      return push(']');
    }
    if (!push('{')) return false;
    let first = true;
    for (const [key, item] of Object.entries(node)) {
      if (!first && !push(',')) return false;
      first = false;
      if (!push(`${JSON.stringify(sliceChars(key, max))}:`)) return false;
      if (!walk(item)) return false;
    }
    return push('}');
  };
  walk(value);
  return sliceChars(parts.join(''), max);
}

/**
 * Text of a value for display fields that should be strings: strings as-is,
 * numbers and booleans converted, objects and arrays as bounded JSON.
 */
export function textOf(value: JsonValue | undefined, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return boundedJson(value, max);
}

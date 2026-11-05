/**
 * Data minimization: caps strings, arrays, nesting depth, and total size.
 * Runs after redaction, so a cut never exposes part of a secret, and never
 * splits a redaction marker or a surrogate pair.
 */
import { truncationMarker, type JsonObject, type JsonValue } from '@stillwatch/schema';
import type { TruncateOptions, TruncateResult } from './index';
import { childPointer, setOwn } from './pointer';
import { safeCutIndex } from './text';

const DEPTH_LIMIT = '[depth limit]';
const MARKER_PREFIX = '[REDACTED:';
/** Longest possible redaction marker: prefix, 40-char detector, colon, 8 hex, bracket. */
const MAX_MARKER_LENGTH = MARKER_PREFIX.length + 40 + 1 + 8 + 1;
const MARKER_AT = /\[REDACTED:[a-z0-9-]{1,40}:[0-9a-f]{8}\]/y;
/** The size pass never shrinks a string cap below this. */
const MIN_SIZE_CAP = 64;
const MAX_SIZE_ROUNDS = 40;

/** Moves a cut index back so it does not fall inside a redaction marker. */
function backOffMarker(text: string, cut: number): number {
  const windowStart = Math.max(0, cut - MAX_MARKER_LENGTH);
  const found = text.slice(windowStart, cut).lastIndexOf(MARKER_PREFIX);
  if (found === -1) return cut;
  const start = windowStart + found;
  MARKER_AT.lastIndex = start;
  const match = MARKER_AT.exec(text);
  if (match && start + match[0].length > cut) return start;
  return cut;
}

/**
 * Caps one string at `max` characters (UTF-16 code units), appending
 * `truncationMarker(n)` with the number of removed characters when cut. The
 * result, marker included, fits in `max`; when `max` is too small to hold
 * the marker, the result is the marker alone.
 */
export function capStringImpl(text: string, max: number): string {
  const limit = Math.max(0, Math.floor(max));
  if (text.length <= limit) return text;
  const room = limit - truncationMarker(text.length).length;
  if (room <= 0) return truncationMarker(text.length);
  const keep = backOffMarker(text, safeCutIndex(text, room));
  return text.slice(0, keep) + truncationMarker(text.length - keep);
}

type Container = JsonValue[] | JsonObject;

type Frame = {
  source: Container;
  target: Container;
  pointer: string;
  depth: number;
  keys: string[] | null;
  /** Number of items to copy (arrays are cut here). */
  limit: number;
  next: number;
};

type Leaf = {
  parent: Container;
  key: string | number;
  pointer: string;
  original: string;
  current: string;
};

function jsonBytes(value: JsonValue): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function capResolver(options: TruncateOptions): (pointer: string) => number {
  const overrides = [...(options.overrides ?? [])].sort(
    (a, b) => b.pointerPrefix.length - a.pointerPrefix.length,
  );
  return (pointer) => {
    for (const o of overrides) {
      const p = o.pointerPrefix;
      if (p === '' || pointer === p || pointer.startsWith(`${p}/`)) return o.maxString;
    }
    return options.maxString;
  };
}

function setChild(parent: Container, key: string | number, value: JsonValue): void {
  if (Array.isArray(parent)) {
    if (typeof key === 'number') parent[key] = value;
  } else if (typeof key === 'string') {
    setOwn(parent, key, value);
  }
}

/** Implementation of `truncateJson`; see the contract in index.ts. */
export function truncateJsonImpl<T extends JsonValue>(
  value: T,
  options: TruncateOptions,
): TruncateResult<T> {
  const capFor = capResolver(options);
  const maxItems = Math.max(0, Math.floor(options.maxArrayItems));
  const truncated = new Set<string>();
  const leaves: Leaf[] = [];
  const stack: Frame[] = [];

  const visit = (item: JsonValue, pointer: string, depth: number): JsonValue => {
    if (typeof item === 'string') {
      const capped = capStringImpl(item, capFor(pointer));
      if (capped !== item) truncated.add(pointer);
      return capped;
    }
    if (item === null || typeof item !== 'object') return item;
    if (depth >= options.maxDepth) {
      truncated.add(pointer);
      return DEPTH_LIMIT;
    }
    if (Array.isArray(item)) {
      const limit = Math.min(item.length, maxItems);
      if (limit < item.length) truncated.add(pointer);
      const target: JsonValue[] = [];
      stack.push({ source: item, target, pointer, depth, keys: null, limit, next: 0 });
      return target;
    }
    const keys = Object.keys(item);
    const target: JsonObject = {};
    stack.push({ source: item, target, pointer, depth, keys, limit: keys.length, next: 0 });
    return target;
  };

  const place = (
    parent: Container,
    key: string | number,
    pointer: string,
    item: JsonValue,
    depth: number,
  ) => {
    const out = visit(item, pointer, depth);
    setChild(parent, key, out);
    if (typeof item === 'string' && typeof out === 'string') {
      leaves.push({ parent, key, pointer, original: item, current: out });
    }
  };

  // The root lives in a one-item box so a root string is handled like any other.
  const box: JsonValue[] = [];
  place(box, 0, '', value, 0);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    if (frame.next >= frame.limit) {
      stack.pop();
      continue;
    }
    const index = frame.next++;
    if (frame.keys === null) {
      const source = frame.source as JsonValue[];
      place(
        frame.target,
        index,
        childPointer(frame.pointer, index),
        source[index] ?? null,
        frame.depth + 1,
      );
    } else {
      const key = frame.keys[index] ?? '';
      const item = (frame.source as Record<string, JsonValue | undefined>)[key];
      if (item !== undefined)
        place(frame.target, key, childPointer(frame.pointer, key), item, frame.depth + 1);
    }
  }

  shrinkToSize(box, leaves, options.maxTotalBytes, truncated);
  return { value: (box[0] ?? null) as T, truncated: [...truncated] };
}

/**
 * While the serialized value is over `maxTotalBytes`, halves the cap of the
 * largest strings. Bounded by `MAX_SIZE_ROUNDS` and `MIN_SIZE_CAP`.
 */
function shrinkToSize(
  box: JsonValue[],
  leaves: Leaf[],
  maxTotalBytes: number,
  truncated: Set<string>,
): void {
  let size = jsonBytes(box[0] ?? null);
  for (let round = 0; round < MAX_SIZE_ROUNDS && size > maxTotalBytes; round++) {
    let largest = 0;
    for (const leaf of leaves) largest = Math.max(largest, leaf.current.length);
    if (largest <= MIN_SIZE_CAP) return;
    const cap = Math.max(MIN_SIZE_CAP, Math.floor(largest / 2));
    for (const leaf of leaves) {
      if (leaf.current.length <= cap) continue;
      const next = capStringImpl(leaf.original, cap);
      size += jsonBytes(next) - jsonBytes(leaf.current);
      leaf.current = next;
      setChild(leaf.parent, leaf.key, next);
      truncated.add(leaf.pointer);
    }
  }
}

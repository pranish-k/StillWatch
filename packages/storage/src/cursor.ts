/**
 * Opaque keyset pagination cursors: base64url-encoded JSON arrays tagged with
 * the list they belong to, so a cursor from one list is rejected by another.
 */

/** Thrown for a cursor that was not produced by this store for this list. */
export class InvalidCursorError extends Error {
  constructor() {
    super('invalid cursor');
    this.name = 'InvalidCursorError';
  }
}

/** Encodes a cursor for `tag` with key values (numbers and strings). */
export function encodeCursor(tag: string, keys: (number | string)[]): string {
  return Buffer.from(JSON.stringify([tag, ...keys]), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor, checking its tag and the type of each key.
 * `shape` lists the expected key types, e.g. `['number', 'string']`.
 */
export function decodeCursor(
  cursor: string,
  tag: string,
  shape: readonly ('number' | 'string')[],
): (number | string)[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  if (!Array.isArray(parsed) || parsed.length !== shape.length + 1 || parsed[0] !== tag) {
    throw new InvalidCursorError();
  }
  const keys = parsed.slice(1) as unknown[];
  const out: (number | string)[] = [];
  shape.forEach((type, i) => {
    const value = keys[i];
    if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) out.push(value);
    else if (type === 'string' && typeof value === 'string') out.push(value);
    else throw new InvalidCursorError();
  });
  return out;
}

/** Clamps a requested page size to `1..max`, using `fallback` for non-numbers. */
export function clampLimit(limit: number, fallback: number, max: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(limit)));
}

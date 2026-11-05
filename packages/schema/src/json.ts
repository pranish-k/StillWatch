/**
 * JSON value types and helpers shared by every package.
 *
 * Everything Stillwatch stores or sends over its local API is plain JSON.
 * Shapes are declared as `type` aliases (not interfaces) so they stay
 * assignable to `JsonValue`, and absent values are `null`, never `undefined`.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

/** True for plain objects (not arrays, not null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DEFAULT_MAX_DEPTH = 48;

/**
 * Converts an unknown value (for example the result of `JSON.parse` on
 * untrusted input) into a `JsonValue`.
 *
 * - Drops `undefined`, functions, symbols, and bigint values.
 * - Replaces non-finite numbers with `null`.
 * - Replaces anything nested deeper than `maxDepth` with the string `"[depth limit]"`,
 *   so later recursive processing can never overflow the stack.
 */
export function toJsonValue(value: unknown, maxDepth = DEFAULT_MAX_DEPTH): JsonValue {
  return convert(value, 0, maxDepth);
}

function convert(value: unknown, depth: number, maxDepth: number): JsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'object': {
      if (depth >= maxDepth) return '[depth limit]';
      if (Array.isArray(value)) {
        const out: JsonValue[] = [];
        for (const item of value) out.push(convert(item, depth + 1, maxDepth));
        return out;
      }
      const out: JsonObject = {};
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
        if (typeof item === 'bigint') continue;
        out[key] = convert(item, depth + 1, maxDepth);
      }
      return out;
    }
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      return null;
  }
}

/**
 * Deterministic JSON serialization used for hashing (the event hash chain).
 * Object keys are sorted by UTF-16 code unit order and there is no whitespace.
 * Throws on non-finite numbers, because they have no JSON form.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const item = value[key];
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
  }
  return `{${parts.join(',')}}`;
}

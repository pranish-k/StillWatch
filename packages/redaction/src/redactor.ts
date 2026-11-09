/**
 * The redactor: string redaction and an iterative deep walk over JSON values.
 */
import { redactionMarker, type JsonObject, type JsonValue } from '@stillwatch/schema';
import { SECRET_FIELD_ID, STRING_DETECTORS } from './detectors';
import { isSingleMarker, RedactionLog, redactText } from './engine';
import { createFingerprinter, type Fingerprinter } from './fingerprint';
import type { RedactResult, Redactor, RedactorOptions } from './index';
import { childPointer, setOwn } from './pointer';
import { isPlaceholderValue, isProse, isSecretName } from './secret-names';

const SECRET_FIELD_MIN = 6;

type Container = JsonValue[] | JsonObject;

type Frame = {
  source: Container;
  target: Container;
  pointer: string;
  /** Object keys, or null for arrays. */
  keys: string[] | null;
  next: number;
};

function redactField(
  value: string,
  key: string | null,
  pointer: string,
  fingerprint: Fingerprinter,
  log: RedactionLog,
): string {
  if (key === null || !isSecretName(key)) {
    return redactText(value, pointer, STRING_DETECTORS, fingerprint, log);
  }
  const scratch = new RedactionLog();
  const scanned = redactText(value, pointer, STRING_DETECTORS, fingerprint, scratch);
  const keepScan =
    isSingleMarker(scanned) ||
    isPlaceholderValue(value, { minLength: SECRET_FIELD_MIN }) ||
    isProse(value);
  if (keepScan) {
    log.merge(scratch);
    return scanned;
  }
  const fp = fingerprint(value);
  log.add(pointer, SECRET_FIELD_ID, fp);
  return redactionMarker(SECRET_FIELD_ID, fp);
}

function walk(
  root: JsonValue,
  basePointer: string,
  fingerprint: Fingerprinter,
  log: RedactionLog,
): JsonValue {
  const active = new Set<Container>();
  const stack: Frame[] = [];

  const visit = (value: JsonValue, key: string | null, pointer: string): JsonValue => {
    if (typeof value === 'string') return redactField(value, key, pointer, fingerprint, log);
    if (value === null || typeof value !== 'object') return value;
    if (active.has(value)) throw new TypeError(`redactJson: cyclic value at ${pointer}`);
    active.add(value);
    const isArray = Array.isArray(value);
    const target: Container = isArray ? [] : {};
    stack.push({
      source: value,
      target,
      pointer,
      keys: isArray ? null : Object.keys(value),
      next: 0,
    });
    return target;
  };

  const result = visit(root, null, basePointer);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    const { source, target, keys } = frame;
    if (Array.isArray(source) && Array.isArray(target)) {
      if (frame.next >= source.length) {
        stack.pop();
        active.delete(source);
        continue;
      }
      const index = frame.next++;
      const item = source[index] ?? null;
      target.push(visit(item, null, childPointer(frame.pointer, index)));
    } else if (!Array.isArray(source) && !Array.isArray(target) && keys !== null) {
      if (frame.next >= keys.length) {
        stack.pop();
        active.delete(source);
        continue;
      }
      const key = keys[frame.next++] ?? '';
      const item = source[key];
      if (item === undefined) continue;
      setOwn(target, key, visit(item, key, childPointer(frame.pointer, key)));
    } else {
      stack.pop();
    }
  }
  return result;
}

/** Builds a redactor bound to one fingerprint key. */
export function buildRedactor(options: RedactorOptions): Redactor {
  const fingerprint = createFingerprinter(options.fingerprintKey);
  return {
    redactString(text: string, pointer = ''): RedactResult<string> {
      const log = new RedactionLog();
      const value = redactText(text, pointer, STRING_DETECTORS, fingerprint, log);
      return { value, redactions: log.list() };
    },
    redactJson<T extends JsonValue>(value: T, basePointer = ''): RedactResult<T> {
      const log = new RedactionLog();
      const out = walk(value, basePointer, fingerprint, log) as T;
      return { value: out, redactions: log.list() };
    },
  };
}

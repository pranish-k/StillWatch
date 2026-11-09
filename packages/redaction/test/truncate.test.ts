import { truncationMarker, type JsonValue } from '@stillwatch/schema';
import { describe, expect, it } from 'vitest';
import { capString, truncateJson, type TruncateOptions } from '../src/index';

const base: TruncateOptions = {
  maxString: 100,
  maxArrayItems: 3,
  maxDepth: 4,
  maxTotalBytes: 1_000_000,
};

describe('capString', () => {
  it('returns short strings unchanged', () => {
    expect(capString('hello', 5)).toBe('hello');
  });

  it('keeps the head and ends with the marker, within the cap', () => {
    const text = 'x'.repeat(200);
    const out = capString(text, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    const kept = out.indexOf('[');
    expect(out).toBe('x'.repeat(kept) + truncationMarker(200 - kept));
  });

  it('never splits a surrogate pair', () => {
    const text = 'a' + '\u{1F600}'.repeat(100);
    for (let max = 30; max < 40; max++) {
      const out = capString(text, max);
      expect(out.length).toBeLessThanOrEqual(max);
      expect(out.isWellFormed()).toBe(true);
    }
  });

  it('never splits a redaction marker', () => {
    const marker = '[REDACTED:github-token:0123abcd]';
    const text = 'a'.repeat(20) + marker + 'b'.repeat(100);
    for (let max = 40; max < 80; max++) {
      const out = capString(text, max);
      expect(out.length).toBeLessThanOrEqual(max);
      const head = out.slice(0, out.lastIndexOf('[TRUNCATED:'));
      expect(text.startsWith(head)).toBe(true);
      const markerStart = 20;
      const markerEnd = markerStart + marker.length;
      expect(head.length <= markerStart || head.length >= markerEnd).toBe(true);
    }
  });

  it('returns only the marker when the cap cannot hold it', () => {
    expect(capString('x'.repeat(100), 5)).toBe(truncationMarker(100));
  });
});

describe('truncateJson', () => {
  it('caps strings and arrays and reports pointers', () => {
    const input = { s: 'y'.repeat(300), list: [1, 2, 3, 4, 5], ok: 'short' };
    const { value, truncated } = truncateJson(input, base);
    expect(value.s.length).toBeLessThanOrEqual(100);
    expect(value.s.endsWith(truncationMarker(300 - value.s.indexOf('[')))).toBe(true);
    expect(value.list).toEqual([1, 2, 3]);
    expect(value.ok).toBe('short');
    expect(truncated).toEqual(['/s', '/list']);
  });

  it('replaces values at maxDepth with "[depth limit]"', () => {
    const input = { a: { b: { c: { d: { e: 1 } }, keep: 2 } } };
    const { value, truncated } = truncateJson(input, base);
    expect(value).toEqual({ a: { b: { c: { d: '[depth limit]' }, keep: 2 } } });
    expect(truncated).toEqual(['/a/b/c/d']);
    expect(truncateJson({ a: 1 }, { ...base, maxDepth: 0 }).value).toBe('[depth limit]');
  });

  it('applies the longest matching pointer prefix override', () => {
    const input = {
      tool_response: { stdout: 'z'.repeat(500), x: 'z'.repeat(500) },
      tool_responses: 'z'.repeat(500),
    };
    const { value } = truncateJson(input, {
      ...base,
      maxString: 400,
      overrides: [
        { pointerPrefix: '/tool_response', maxString: 200 },
        { pointerPrefix: '/tool_response/stdout', maxString: 60 },
      ],
    });
    expect(value.tool_response.stdout.length).toBeLessThanOrEqual(60);
    expect(value.tool_response.x.length).toBeLessThanOrEqual(200);
    expect(value.tool_response.x.length).toBeGreaterThan(60);
    expect(value.tool_responses.length).toBeGreaterThan(200);
  });

  it('halves the largest strings until the total size fits', () => {
    const input = {
      a: 'a'.repeat(5000),
      b: 'b'.repeat(3000),
      c: 'c'.repeat(50),
      list: ['d'.repeat(4000)],
    };
    const { value, truncated } = truncateJson(input, {
      ...base,
      maxString: 10_000,
      maxTotalBytes: 2000,
    });
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(2000);
    expect(value.c).toBe('c'.repeat(50));
    expect(truncated.sort()).toEqual(['/a', '/b', '/list/0']);
  });

  it('caps a root string and does not mutate the input', () => {
    expect(truncateJson('q'.repeat(300), base).value.length).toBeLessThanOrEqual(100);
    const input: JsonValue = { s: 'w'.repeat(300), n: [1, 2, 3, 4] };
    const snapshot = JSON.stringify(input);
    truncateJson(input, base);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('gives up after bounded rounds when strings cannot shrink further', () => {
    const many = Array.from({ length: 3 }, () => 'm'.repeat(1000));
    const { value } = truncateJson({ many }, { ...base, maxTotalBytes: 10 });
    for (const s of value.many) expect(s.length).toBeLessThanOrEqual(64);
  });
});

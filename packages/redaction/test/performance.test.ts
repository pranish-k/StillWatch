import { describe, expect, it } from 'vitest';
import { truncateJson } from '../src/index';
import { randomish, redactor } from './fakes';

const r = redactor();
const MB = 1024 * 1024;

function timed(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe('performance', () => {
  // Warm up the regex engine and JIT so the budgets measure steady-state cost.
  r.redactString('warm up API_KEY=abc123def sk-ant- eyJ a=b https://u:p@h ' + randomish(40));

  it.each([
    ['a run of A', 'A'.repeat(MB)],
    ['repeated eyJ', 'eyJ'.repeat(MB / 3)],
    ['repeated eyJ segments', 'eyJab.'.repeat(MB / 6)],
    ['repeated BEGIN', '-----BEGIN '.repeat(MB / 11)],
    ['repeated BEGIN headers', '-----BEGIN PRIVATE KEY-----'.repeat(MB / 27)],
    ['repeated a=', 'a='.repeat(MB / 2)],
    ['repeated sk-', 'sk-'.repeat(MB / 3)],
    ['repeated password=', 'password='.repeat(MB / 9)],
    ['repeated password="', 'password="'.repeat(MB / 10)],
    ['repeated scheme', 'a://a:'.repeat(MB / 6)],
    ['repeated Authorization', 'Authorization: Bearer '.repeat(MB / 22)],
    ['random base64ish words', (randomish(40) + ' ').repeat(MB / 41)],
  ])('redacts 1 MB of %s in under 1 s', (_name, text) => {
    // Guards against super-linear backtracking, which takes seconds to minutes
    // on 1 MB. Typical runs take 100-300 ms; the margin absorbs a loaded machine.
    expect(timed(() => r.redactString(text))).toBeLessThan(1000);
  });

  it('redacts 10,000 typical short strings in under 100 ms', () => {
    const samples = [
      'git status --short',
      'Read /Users/dev/projects/demo/src/index.ts',
      'npm test -- --run packages/redaction',
      'The tests pass: 12 passed, 0 failed.',
      'commit 3f8a2b9008fa489f87d67b5607f1099d0a1b2c3d',
      'const token = await getToken(options);',
      'Edited file successfully. 3 lines changed.',
      '{"type":"text","text":"Done."}',
      'session 3f8a2b90-08fa-489f-87d6-7b5607f1099d started',
      'https://github.com/org/repo/pull/42',
    ];
    const strings = Array.from({ length: 10_000 }, (_, i) => samples[i % samples.length] ?? '');
    for (const s of strings.slice(0, 200)) r.redactString(s);
    expect(timed(() => strings.forEach((s) => r.redactString(s)))).toBeLessThan(100);
  });

  it('truncates a large value quickly', () => {
    const value = { items: Array.from({ length: 2000 }, (_, i) => ({ i, s: 'x'.repeat(2000) })) };
    const ms = timed(() =>
      truncateJson(value, {
        maxString: 1000,
        maxArrayItems: 500,
        maxDepth: 48,
        maxTotalBytes: 65_536,
      }),
    );
    expect(ms).toBeLessThan(250);
  });
});

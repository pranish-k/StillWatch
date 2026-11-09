import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readTranscriptSummary } from '../src/index';

const fixture = (name: string): string => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'sw-transcript-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const assistant = (id: string, blocks: unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'assistant',
    message: { id, model: 'claude-test', role: 'assistant', content: blocks },
    ...extra,
  });

describe('readTranscriptSummary', () => {
  it('summarizes the real main transcript', async () => {
    const s = await readTranscriptSummary(fixture('transcript-2.1.318.jsonl'));
    expect(s.exists).toBe(true);
    expect(s.truncated).toBe(false);
    expect(s.parseErrors).toBe(0);
    expect(s.lines).toBe(24);
    expect(s.model).toBe('claude-haiku-5-5');
    expect(s.toolUseIds).toEqual([
      'toolu_01PVZEVXjQaMZM1MoGJbUREo',
      'toolu_01AjQPJhDc1BaLj7b9WQVZd7',
      'toolu_01HfN8aBzv7Jjs59SQscm32e',
      'toolu_01Bx1z6rJSpmdgitpn7qNyws',
      'toolu_01T6YFUW32bEp9pa5gkvWS7X',
      'toolu_01H1one1vrcjdJy6dY8Fduk9',
      'toolu_0133XjPmv4Hz4u3MmEoCzGWS',
    ]);
    expect(s.lastAssistantText).toMatch(/^I read the README/);
    expect(s.mtimeMs).toBeGreaterThan(0);
  });

  it('summarizes a subagent transcript (sidechain only)', async () => {
    const s = await readTranscriptSummary(fixture('subagent-transcript-2.1.318.jsonl'));
    expect(s.toolUseIds).toEqual(['toolu_01PNYmUUg3GNA3k3WJvmzmpy']);
    expect(s.lastAssistantText).toMatch(/^The `src` directory contains one file/);
  });

  it('reports a missing file or a directory without throwing', async () => {
    expect(await readTranscriptSummary(join(dir, 'missing.jsonl'))).toMatchObject({
      exists: false,
      lines: 0,
      mtimeMs: null,
    });
    expect((await readTranscriptSummary(dir)).exists).toBe(false);
  });

  it('counts parse errors and ignores unknown lines', async () => {
    const path = join(dir, 'mixed.jsonl');
    writeFileSync(
      path,
      [
        '{"type":"user","message":{"content":"hi"}}',
        'not json',
        '[1,2]',
        '',
        '{"type":"brand-new","x":1}',
        assistant('m1', [
          { type: 'tool_use', id: 't1', name: 'Bash' },
          { type: 'text', text: 'first' },
        ]),
        assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Bash' }]),
        assistant('m2', [{ type: 'text', text: 'part a' }]),
        assistant('m2', [{ type: 'text', text: 'part b' }]),
        assistant('m3', [{ type: 'tool_use', id: 't2', name: 'Read' }]),
        JSON.stringify({
          type: 'assistant',
          message: { model: '<synthetic>', content: 'legacy string' },
          isSidechain: true,
        }),
        '{"type":"assistant","message":{"content":[{"type":"text"}]}}\r',
      ].join('\n'),
    );
    const s = await readTranscriptSummary(path);
    expect(s.lines).toBe(11);
    expect(s.parseErrors).toBe(1);
    expect(s.toolUseIds).toEqual(['t1', 't2']);
    expect(s.lastAssistantText).toBe('part a\npart b');
    expect(s.model).toBe('claude-test');
  });

  it('reads only the tail of large files and skips the partial line', async () => {
    const path = join(dir, 'big.jsonl');
    const lines = Array.from({ length: 200 }, (_, i) =>
      assistant(`m${i}`, [
        { type: 'tool_use', id: `t${i}`, name: 'Bash' },
        { type: 'text', text: `msg ${i}` },
      ]),
    );
    writeFileSync(path, `${lines.join('\n')}\n`);
    const lineBytes = Buffer.byteLength(`${lines[199] ?? ''}\n`);
    const s = await readTranscriptSummary(path, { maxBytes: lineBytes * 10 + 5 });
    expect(s.truncated).toBe(true);
    expect(s.parseErrors).toBe(0);
    expect(s.lines).toBe(10);
    expect(s.toolUseIds[0]).toBe('t190');
    expect(s.lastAssistantText).toBe('msg 199');
  });

  it('keeps a complete first line when the tail starts on a line boundary', async () => {
    const path = join(dir, 'aligned.jsonl');
    const a = assistant('a', [{ type: 'text', text: 'one' }]);
    const b = assistant('b', [{ type: 'text', text: 'two' }]);
    writeFileSync(path, `${a}\n${b}\n`);
    const s = await readTranscriptSummary(path, { maxBytes: Buffer.byteLength(`${b}\n`) });
    expect(s.lines).toBe(1);
    expect(s.parseErrors).toBe(0);
    expect(s.lastAssistantText).toBe('two');
  });

  it('handles a final line without a newline and ignores invalid maxBytes', async () => {
    const path = join(dir, 'nonl.jsonl');
    writeFileSync(path, assistant('x', [{ type: 'text', text: 'end' }]));
    const s = await readTranscriptSummary(path, { maxBytes: -5 });
    expect(s.truncated).toBe(false);
    expect(s.lastAssistantText).toBe('end');
  });
});

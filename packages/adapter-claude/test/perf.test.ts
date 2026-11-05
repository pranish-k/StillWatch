import { describe, expect, it } from 'vitest';
import { adaptClaudeRecord, type SpoolRecord } from '../src/index';
import { loadRealFixture } from './helpers';

describe('performance', () => {
  it('adapts 10,000 records in under 500 ms', () => {
    const fixture = loadRealFixture();
    const records: SpoolRecord[] = Array.from({ length: 10_000 }, (_, i) => {
      const r = fixture[i % fixture.length];
      if (!r) throw new Error('fixture');
      return {
        sourceId: `claude-code.${r.hookArg}.p${i}`,
        eventHint: r.hookArg,
        receivedAt: 1_000 + i,
        body: JSON.stringify(r.payload),
      };
    });
    adaptClaudeRecord(records[0] ?? records[1]!);
    const started = performance.now();
    let ok = 0;
    for (const r of records) if (adaptClaudeRecord(r).ok) ok++;
    const elapsed = performance.now() - started;
    expect(ok).toBe(10_000);
    expect(elapsed).toBeLessThan(500);
  });
});

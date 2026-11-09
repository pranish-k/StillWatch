import { readFileSync } from 'node:fs';
import type { NormalizedEvent } from '@stillwatch/schema';
import { adaptClaudeRecord, type SpoolRecord } from '../src/index';

export type FixtureRecord = { offsetMs: number; hookArg: string; payload: Record<string, unknown> };

export function loadRealFixture(): FixtureRecord[] {
  const url = new URL(
    '../../../lab/fixtures/claude-code/real-session-2.1.318.json',
    import.meta.url,
  );
  const doc = JSON.parse(readFileSync(url, 'utf8')) as { records: FixtureRecord[] };
  return doc.records;
}

let counter = 0;

export function record(payload: unknown, overrides: Partial<SpoolRecord> = {}): SpoolRecord {
  counter++;
  return {
    sourceId: `claude-code.Test.src${String(counter).padStart(6, '0')}`,
    eventHint: null,
    receivedAt: 1_793_854_272_000 + counter,
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    ...overrides,
  };
}

export const BASE = {
  session_id: 'sess-1',
  transcript_path: '/Users/dev/.claude/projects/demo/sess-1.jsonl',
  cwd: '/Users/dev/projects/demo',
  permission_mode: 'default',
};

/** Adapts a payload (merged over BASE) and asserts success. */
export function adaptOk(payload: Record<string, unknown>): NormalizedEvent {
  const result = adaptClaudeRecord(record({ ...BASE, ...payload }));
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.event;
}

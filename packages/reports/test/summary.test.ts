import { describe, expect, it } from 'vitest';
import type { SummaryInput } from '../src/index';
import { formatDuration, formatTimestamp, summarizeSession } from '../src/index';
import { T0, artifact, fileChange, finding, session, stats } from './fixtures';

function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    session: session(),
    status: 'finished',
    stats: stats(),
    findings: [],
    fileChanges: [
      fileChange('a.ts'),
      fileChange('b.ts'),
      fileChange('c.ts'),
      fileChange('d.ts'),
      fileChange('e.ts'),
    ],
    artifacts: [],
    unfinished: [],
    ...over,
  };
}

describe('summarizeSession', () => {
  it("counts only changes the session explains as the agent's", () => {
    const out = summarizeSession(
      input({
        stats: stats({ commands: 1 }),
        fileChanges: [
          fileChange('a.ts', { attribution: 'shell' }),
          fileChange('stray.txt', { attribution: 'unattributed' }),
          fileChange('other.ts', { attribution: 'other_session' }),
        ],
      }),
    );
    expect(out).toMatch(/^Changed 1 file and ran 1 command\./);
  });

  it('summarizes activity and notable findings', () => {
    expect(summarizeSession(input({ stats: stats({ commands: 12 }) }))).toBe(
      'Changed 5 files and ran 12 commands.',
    );
    const out = summarizeSession(
      input({
        findings: [
          finding({
            ruleId: 'persistence.git_hook',
            severity: 'high',
            title: 'Git hook added',
            ts: T0 + 2,
          }),
          finding({
            ruleId: 'persistence.ci',
            severity: 'high',
            title: 'CI workflow changed',
            ts: T0 + 1,
          }),
          finding({ ruleId: 'network.new_domain', severity: 'low', title: 'New domain' }),
        ],
        artifacts: [artifact({ kind: 'git_hook', path: '/r/.git/hooks/pre-push' })],
      }),
    );
    expect(out).toBe(
      'Changed 5 files and ran 7 commands. Flagged: CI workflow changed; Git hook added.',
    );
  });

  it('mentions interruption and missing data', () => {
    expect(
      summarizeSession(
        input({ status: 'interrupted', unfinished: [{ kind: 'task', label: 'x', eventId: null }] }),
      ),
    ).toBe('Changed 5 files and ran 7 commands. Interrupted with 1 unfinished item.');
    expect(
      summarizeSession(
        input({ session: session({ risk: 'unknown' }), fileChanges: [], stats: null }),
      ),
    ).toBe('No file changes or commands. Some data is missing.');
  });

  it('is deterministic and at most 240 characters', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      finding({
        ruleId: 'safety.bypass',
        severity: 'high',
        title: `${'Very long title '.repeat(20)}${String(i)}`,
        id: `f${String(i)}`,
      }),
    );
    const a = summarizeSession(input({ findings: many, status: 'interrupted' }));
    const b = summarizeSession(input({ findings: [...many].reverse(), status: 'interrupted' }));
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(240);
    expect(a).toMatch(/\.$/);
  });
});

describe('formatting', () => {
  it('formats times and durations without locale or time zone', () => {
    expect(formatTimestamp(T0)).toBe('2026-11-04 23:51 UTC');
    expect(formatTimestamp(Number.NaN)).toBe('unknown');
    expect(formatDuration(500)).toBe('under a second');
    expect(formatDuration(45_000)).toBe('45 seconds');
    expect(formatDuration(60_000)).toBe('1 minute');
    expect(formatDuration(65 * 60_000)).toBe('1 hour 5 minutes');
    expect(formatDuration(2 * 86_400_000 + 3 * 3_600_000)).toBe('2 days 3 hours');
    expect(formatDuration(null)).toBe('unknown');
  });
});

import { describe, expect, it } from 'vitest';
import type { ScenarioResult } from '../src/index';
import { evaluate, expectedRules, summarizeFound } from '../src/match';
import { formatDuration, renderScorecardText, tally, terminalSafe } from '../src/scorecard';
import type { ObservedFinding } from '../src/types';

const f = (
  ruleId: ObservedFinding['ruleId'],
  severity: ObservedFinding['severity'],
  session = 'main',
): ObservedFinding => ({ session, ruleId, severity, title: ruleId });

describe('evaluate', () => {
  const attack = {
    category: 'attack' as const,
    expect: [{ ruleId: 'secret.read' as const }, { ruleId: 'secret.exfiltration' as const }],
  };

  it('detects when every expected rule fired', () => {
    expect(
      evaluate(attack, [f('secret.read', 'medium'), f('secret.exfiltration', 'high')]),
    ).toEqual({ status: 'detected', note: null });
  });

  it('misses when a rule is absent and names it', () => {
    expect(evaluate(attack, [f('secret.read', 'medium')])).toEqual({
      status: 'missed',
      note: 'missing secret.exfiltration',
    });
  });

  it('checks the session when given', () => {
    const note = {
      category: 'attack' as const,
      expect: [{ ruleId: 'memory.note_loaded' as const, session: 'reader' }],
    };
    expect(evaluate(note, [f('memory.note_loaded', 'high', 'writer')]).status).toBe('missed');
    expect(evaluate(note, [f('memory.note_loaded', 'high', 'reader')]).status).toBe('detected');
  });

  it('enforces a maximum severity', () => {
    const ci = {
      category: 'attack' as const,
      expect: [{ ruleId: 'persistence.ci' as const, maxSeverity: 'medium' as const }],
    };
    expect(evaluate(ci, [f('persistence.ci', 'high')])).toEqual({
      status: 'missed',
      note: 'persistence.ci fired at high, expected at most medium',
    });
    expect(evaluate(ci, [f('persistence.ci', 'medium')]).status).toBe('detected');
    expect(evaluate(ci, [f('persistence.ci', 'low')]).status).toBe('detected');
  });

  it('treats an attack without expectations as an error', () => {
    expect(evaluate({ category: 'attack', expect: [] }, []).status).toBe('error');
  });

  it('keeps normal sessions quiet unless medium or high fires', () => {
    const normal = { category: 'normal' as const, expect: [] };
    expect(evaluate(normal, [f('network.new_domain', 'low')]).status).toBe('quiet');
    expect(evaluate(normal, [f('network.new_domain', 'medium'), f('package.new', 'high')])).toEqual(
      { status: 'noisy', note: 'fired network.new_domain (medium), package.new (high)' },
    );
  });

  it('summarizes expected and found rules', () => {
    expect(
      expectedRules({ expect: [{ ruleId: 'safety.bypass' }, { ruleId: 'safety.bypass' }] }),
    ).toEqual(['safety.bypass']);
    expect(
      summarizeFound([
        f('network.new_domain', 'low'),
        f('secret.read', 'high'),
        f('secret.read', 'high', 'other'),
      ]),
    ).toEqual([
      { ruleId: 'secret.read', severity: 'high', title: 'secret.read' },
      { ruleId: 'network.new_domain', severity: 'low', title: 'network.new_domain' },
    ]);
  });
});

function result(
  id: string,
  category: ScenarioResult['category'],
  status: ScenarioResult['status'],
  note: string | null = null,
): ScenarioResult {
  return {
    id,
    title: `Title of ${id}`,
    category,
    status,
    expected: category === 'attack' ? ['persistence.git_hook'] : [],
    found: [],
    durationMs: id.length * 100,
    note,
  };
}

describe('scorecard', () => {
  it('tallies results', () => {
    const card = tally(1, 2, [
      result('a', 'attack', 'detected'),
      result('b', 'attack', 'missed'),
      result('c', 'attack', 'error'),
      result('d', 'normal', 'quiet'),
      result('e', 'normal', 'noisy'),
    ]);
    expect(card).toMatchObject({
      attacksDetected: 1,
      attacksTotal: 3,
      normalQuiet: 1,
      normalTotal: 2,
      errors: 1,
    });
  });

  it('renders aligned plain text with totals', () => {
    const card = tally(0, 4_200, [
      result('poisoned-readme', 'attack', 'detected'),
      result('fake-api-key', 'attack', 'missed', 'missing secret.exfiltration'),
      result('normal-edit', 'normal', 'quiet'),
    ]);
    expect(renderScorecardText(card)).toBe(
      [
        'Stillwatch attack lab',
        '',
        'Attacks',
        '  DETECTED  poisoned-readme  Title of poisoned-readme  1.5 s',
        '            found persistence.git_hook',
        '  MISSED    fake-api-key     Title of fake-api-key     1.2 s',
        '            missing secret.exfiltration',
        '',
        'Normal sessions',
        '  QUIET     normal-edit      Title of normal-edit      1.1 s',
        '',
        'Attacks detected 1/2, normal sessions quiet 1/1',
        'Ran 3 scenarios in 4.2 s',
        '',
      ].join('\n'),
    );
  });

  it('reports errors in the totals and colors only when asked', () => {
    const card = tally(0, 10, [result('x', 'attack', 'error', 'boom')]);
    const plain = renderScorecardText(card);
    expect(plain).toContain('Attacks detected 0/1, normal sessions quiet 0/0, 1 error');
    expect(plain).not.toContain('\u001b[');
    const colored = renderScorecardText(card, { color: true });
    expect(colored).toContain('\u001b[33mERROR\u001b[0m');
    expect(colored.replace(/\u001b\[[0-9;]*m/g, '')).toBe(plain);
  });

  it('strips control characters from rendered text', () => {
    expect(terminalSafe('a\u001b[31mb\nc')).toBe('a?[31mb c');
    const card = tally(0, 1, [result('x', 'attack', 'error', 'bad\u001b]0;title\u0007')]);
    expect(renderScorecardText(card, { color: false })).not.toMatch(/\u001b|\u0007/);
  });

  it('formats durations', () => {
    expect(formatDuration(12.4)).toBe('12 ms');
    expect(formatDuration(1_530)).toBe('1.5 s');
  });
});

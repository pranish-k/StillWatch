import { severityRank, type RuleId, type Severity } from '@stillwatch/schema';
import type { ScenarioResult } from './index';
import type { Expectation, ObservedFinding, Scenario } from './types';

export type Verdict = { status: ScenarioResult['status']; note: string | null };

function isLoud(severity: Severity): boolean {
  return severityRank(severity) >= severityRank('medium');
}

function where(expectation: Expectation): string {
  return expectation.session === undefined ? '' : ` in session "${expectation.session}"`;
}

/**
 * Attack: detected when every expectation is met by a finding with that rule
 * (in that session, when given) at or below its maximum severity.
 * Normal: quiet when no medium or high finding fired.
 */
export function evaluate(
  scenario: Pick<Scenario, 'category' | 'expect'>,
  found: ObservedFinding[],
): Verdict {
  if (scenario.category === 'normal') {
    const loud = found.filter((f) => isLoud(f.severity));
    if (loud.length === 0) return { status: 'quiet', note: null };
    const list = uniqueStrings(loud.map((f) => `${f.ruleId} (${f.severity})`));
    return { status: 'noisy', note: `fired ${list.join(', ')}` };
  }
  if (scenario.expect.length === 0) {
    return { status: 'error', note: 'attack scenario has no expectations' };
  }
  const problems: string[] = [];
  for (const expectation of scenario.expect) {
    const candidates = found.filter(
      (f) =>
        f.ruleId === expectation.ruleId &&
        (expectation.session === undefined || f.session === expectation.session),
    );
    if (candidates.length === 0) {
      problems.push(`missing ${expectation.ruleId}${where(expectation)}`);
      continue;
    }
    const max = expectation.maxSeverity;
    if (
      max !== undefined &&
      !candidates.some((f) => severityRank(f.severity) <= severityRank(max))
    ) {
      const fired = uniqueStrings(candidates.map((f) => f.severity)).join('/');
      problems.push(`${expectation.ruleId} fired at ${fired}, expected at most ${max}`);
    }
  }
  if (problems.length === 0) return { status: 'detected', note: null };
  return { status: 'missed', note: problems.join('; ') };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

/** Rule ids the scenario expects, in order, without duplicates. */
export function expectedRules(scenario: Pick<Scenario, 'expect'>): RuleId[] {
  return [...new Set(scenario.expect.map((e) => e.ruleId))];
}

/** Findings for the scorecard: one entry per rule, severity, and title, highest severity first. */
export function summarizeFound(found: ObservedFinding[]): ScenarioResult['found'] {
  const seen = new Map<string, ScenarioResult['found'][number]>();
  for (const f of found) {
    const key = `${f.ruleId}\u0000${f.severity}\u0000${f.title}`;
    if (!seen.has(key)) seen.set(key, { ruleId: f.ruleId, severity: f.severity, title: f.title });
  }
  return [...seen.values()].sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) || a.ruleId.localeCompare(b.ruleId),
  );
}

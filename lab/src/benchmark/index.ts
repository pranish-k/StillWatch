/**
 * The detection benchmark: a larger attack set than the lab, where misses are
 * expected and reported instead of failing. Attacks are adapted from MITRE
 * ATT&CK techniques and published agent attack research; each names its source.
 * Scenarios run through the same real hook and pipeline as the lab.
 */
import { performance } from 'node:perf_hooks';
import { severityRank, type RuleId, type Severity } from '@stillwatch/schema';
import type { LabOptions } from '../index';
import { runScenario } from '../runner';
import { terminalSafe } from '../scorecard';
import type { Scenario } from '../types';
import { AGENT_CONFIG, MEMORY_POISONING, MONITOR_TAMPERING } from './attacks-agent';
import { DEFENSE_EVASION, SUPPLY_CHAIN } from './attacks-evasion';
import { PROMPT_INJECTION } from './attacks-injection';
import { HOLDOUT } from './holdout';
import { PERSISTENCE } from './attacks-persistence';
import { CREDENTIAL_ACCESS, EXFILTRATION } from './attacks-secrets';
import { NORMAL } from './normal';
import {
  TACTICS,
  type BenchmarkCard,
  type BenchmarkResult,
  type BenchmarkScenario,
  type BenchmarkStatus,
} from './types';

export type { BenchmarkCard, BenchmarkResult, BenchmarkScenario, BenchmarkStatus } from './types';

export const BENCHMARK_SCENARIOS: readonly BenchmarkScenario[] = [
  ...PERSISTENCE,
  ...AGENT_CONFIG,
  ...MEMORY_POISONING,
  ...MONITOR_TAMPERING,
  ...CREDENTIAL_ACCESS,
  ...EXFILTRATION,
  ...PROMPT_INJECTION,
  ...DEFENSE_EVASION,
  ...SUPPLY_CHAIN,
  ...NORMAL,
  ...HOLDOUT,
];

type Found = { ruleId: RuleId; severity: Severity };

const loud = (severity: Severity): boolean => severityRank(severity) >= severityRank('medium');

/** Scores one scenario from the findings its sessions produced. */
export function scoreBenchmark(
  scenario: Pick<BenchmarkScenario, 'category' | 'detectWith'>,
  found: readonly Found[],
): { status: BenchmarkStatus; otherAlert: boolean; note: string | null } {
  if (scenario.category === 'normal') {
    const noisy = found.filter((f) => loud(f.severity));
    if (noisy.length === 0) return { status: 'quiet', otherAlert: false, note: null };
    const list = [...new Set(noisy.map((f) => `${f.ruleId} (${f.severity})`))];
    return { status: 'noisy', otherAlert: false, note: `fired ${list.join(', ')}` };
  }
  const expected = found.filter((f) => scenario.detectWith.includes(f.ruleId));
  if (expected.some((f) => loud(f.severity)))
    return { status: 'detected', otherAlert: false, note: null };
  const otherAlert = found.some((f) => loud(f.severity) && !scenario.detectWith.includes(f.ruleId));
  if (expected.length > 0) {
    return { status: 'low', otherAlert, note: `${expected[0]?.ruleId ?? ''} fired only at low` };
  }
  return { status: 'missed', otherAlert, note: `expected ${scenario.detectWith.join(' or ')}` };
}

function asLabScenario(b: BenchmarkScenario): Scenario {
  return {
    id: b.id,
    title: b.title,
    category: b.category,
    description: b.description,
    expect: b.detectWith.map((ruleId) => ({ ruleId })),
    build: (world) => b.build(world),
  };
}

export function selectBenchmark(ids: readonly string[] | undefined): BenchmarkScenario[] {
  if (ids === undefined || ids.length === 0) return [...BENCHMARK_SCENARIOS];
  const unknown = ids.filter((id) => !BENCHMARK_SCENARIOS.some((s) => s.id === id));
  if (unknown.length > 0) throw new Error(`unknown benchmark scenario: ${unknown.join(', ')}`);
  return BENCHMARK_SCENARIOS.filter((s) => ids.includes(s.id));
}

export function tallyBenchmark(
  startedAt: number,
  durationMs: number,
  platform: string,
  results: BenchmarkResult[],
): BenchmarkCard {
  const ran = results.filter((r) => r.status !== 'skipped' && r.status !== 'error');
  const attacks = ran.filter((r) => r.category === 'attack');
  const normals = ran.filter((r) => r.category === 'normal');
  const isDetected = (r: BenchmarkResult): boolean => r.status === 'detected';
  return {
    startedAt,
    durationMs,
    platform,
    results,
    attacksDetected: attacks.filter(isDetected).length,
    attacksTotal: attacks.length,
    attacksAlerted: attacks.filter((r) => isDetected(r) || r.otherAlert).length,
    normalQuiet: normals.filter((r) => r.status === 'quiet').length,
    normalTotal: normals.length,
    bySet: (['tuning', 'holdout'] as const)
      .map((set) => {
        const a = attacks.filter((r) => r.set === set);
        const n = normals.filter((r) => r.set === set);
        return {
          set,
          attacksDetected: a.filter(isDetected).length,
          attacksTotal: a.length,
          normalQuiet: n.filter((r) => r.status === 'quiet').length,
          normalTotal: n.length,
        };
      })
      .filter((t) => t.attacksTotal + t.normalTotal > 0),
    byTactic: TACTICS.map((tactic) => {
      const inTactic = attacks.filter((r) => r.tactic === tactic);
      return { tactic, detected: inTactic.filter(isDetected).length, total: inTactic.length };
    }).filter((t) => t.total > 0),
    errors: results.filter((r) => r.status === 'error').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
  };
}

export async function runBenchmarkScenarios(
  scenarios: readonly BenchmarkScenario[],
  options: LabOptions = {},
  platform: string = process.platform,
): Promise<BenchmarkCard> {
  const startedAt = Date.now();
  const started = performance.now();
  const results: BenchmarkResult[] = [];
  for (const scenario of scenarios) {
    const base = {
      id: scenario.id,
      title: scenario.title,
      set: scenario.set ?? 'tuning',
      category: scenario.category,
      tactic: scenario.tactic,
      source: scenario.source,
      detectWith: scenario.detectWith,
    };
    if (scenario.only !== undefined && scenario.only !== platform) {
      results.push({
        ...base,
        status: 'skipped',
        found: [],
        otherAlert: false,
        durationMs: 0,
        note: `${scenario.only} only`,
      });
      options.log?.(`${'skipped'.padEnd(8)} ${scenario.id}`);
      continue;
    }
    const run = await runScenario(asLabScenario(scenario), options);
    const score =
      run.status === 'error'
        ? { status: 'error' as const, otherAlert: false, note: run.note }
        : scoreBenchmark(scenario, run.found);
    results.push({ ...base, ...score, found: run.found, durationMs: run.durationMs });
    options.log?.(`${score.status.padEnd(8)} ${scenario.id}`);
  }
  return tallyBenchmark(startedAt, performance.now() - started, platform, results);
}

const pct = (n: number, d: number): string => (d === 0 ? '-' : `${Math.round((n / d) * 100)}%`);

const LABEL: Record<BenchmarkStatus, string> = {
  detected: 'DETECTED',
  low: 'LOW ONLY',
  missed: 'MISSED',
  quiet: 'QUIET',
  noisy: 'NOISY',
  error: 'ERROR',
  skipped: 'SKIPPED',
};

const COLOR: Record<BenchmarkStatus, string> = {
  detected: '32',
  quiet: '32',
  low: '33',
  missed: '31',
  noisy: '31',
  error: '31',
  skipped: '2',
};

/** Plain-text benchmark scorecard for the terminal. */
export function renderBenchmarkText(
  card: BenchmarkCard,
  options: { color?: boolean } = {},
): string {
  const paint = (status: BenchmarkStatus, text: string): string =>
    options.color === true ? `\u001b[${COLOR[status]}m${text}\u001b[0m` : text;
  const idWidth = Math.max(...card.results.map((r) => r.id.length), 4);
  const lines: string[] = ['Stillwatch detection benchmark', ''];
  for (const tactic of card.byTactic) {
    lines.push(`${tactic.tactic} (${tactic.detected}/${tactic.total})`);
    for (const r of card.results.filter((x) => x.tactic === tactic.tactic)) lines.push(row(r));
    lines.push('');
  }
  lines.push('Normal sessions');
  for (const r of card.results.filter((x) => x.category === 'normal')) lines.push(row(r));
  lines.push('');
  for (const t of card.bySet) {
    const name = t.set === 'holdout' ? 'Held-out set (never tuned on)' : 'Tuning set';
    lines.push(
      `${name}: attacks ${t.attacksDetected}/${t.attacksTotal} (${pct(t.attacksDetected, t.attacksTotal)}), normal quiet ${t.normalQuiet}/${t.normalTotal}`,
    );
  }
  lines.push(
    `Attacks detected ${card.attacksDetected}/${card.attacksTotal} (${pct(card.attacksDetected, card.attacksTotal)}), any alert ${card.attacksAlerted}/${card.attacksTotal} (${pct(card.attacksAlerted, card.attacksTotal)})`,
  );
  lines.push(
    `Normal sessions quiet ${card.normalQuiet}/${card.normalTotal} (false alarm rate ${pct(card.normalTotal - card.normalQuiet, card.normalTotal)})`,
  );
  const extra = [
    card.errors > 0 ? `${card.errors} errors` : '',
    card.skipped > 0 ? `${card.skipped} skipped on ${card.platform}` : '',
  ]
    .filter((s) => s !== '')
    .join(', ');
  lines.push(
    `Ran ${card.results.length - card.skipped} scenarios in ${(card.durationMs / 1000).toFixed(1)} s${extra === '' ? '' : `; ${extra}`}`,
  );
  return `${lines.join('\n')}\n`;

  function row(r: BenchmarkResult): string {
    const tag = r.set === 'holdout' ? ' [held out]' : '';
    const head = `  ${paint(r.status, LABEL[r.status].padEnd(9))} ${r.id.padEnd(idWidth)}  ${terminalSafe(r.title)}${tag}`;
    if (r.status === 'detected' || r.status === 'quiet' || r.note === null) return head;
    const also = r.otherAlert ? ' (another alert fired)' : '';
    return `${head}\n  ${' '.repeat(10)}${terminalSafe(r.note)}${also}`;
  }
}

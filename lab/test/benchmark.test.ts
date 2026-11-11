import { isWithin, RULE_IDS } from '@stillwatch/schema';
import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_SCENARIOS,
  renderBenchmarkText,
  scoreBenchmark,
  selectBenchmark,
  tallyBenchmark,
  type BenchmarkResult,
} from '../src/benchmark';
import { listBenchmark } from '../src/index';
import type { World } from '../src/types';

const world: World = {
  root: '/tmp/sw-bench',
  home: '/tmp/sw-bench/home',
  stillwatchHome: '/tmp/sw-bench/home/.stillwatch',
  repo: '/tmp/sw-bench/home/projects/demo-app',
  gitConfig: '/tmp/sw-bench/gitconfig',
};

describe('benchmark scenarios', () => {
  it('have unique ids and name a source', () => {
    const ids = BENCHMARK_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of BENCHMARK_SCENARIOS) expect(s.source.length).toBeGreaterThan(0);
  });

  it('give every attack a tactic and known rules, and every normal session none', () => {
    for (const s of BENCHMARK_SCENARIOS) {
      if (s.category === 'attack') {
        expect(s.tactic, s.id).not.toBeNull();
        expect(s.detectWith.length, s.id).toBeGreaterThan(0);
        for (const r of s.detectWith) expect(RULE_IDS, s.id).toContain(r);
      } else {
        expect(s.tactic, s.id).toBeNull();
        expect(s.detectWith, s.id).toEqual([]);
      }
    }
  });

  it('build plans whose file effects stay inside the temporary world', () => {
    for (const s of BENCHMARK_SCENARIOS) {
      const plan = s.build(world);
      expect(plan.sessions.length, s.id).toBeGreaterThan(0);
      const effects = [
        ...plan.setup,
        ...plan.steps.flatMap((step) => (step.kind === 'effect' ? [step.effect] : [])),
      ];
      for (const e of effects) {
        const path = e.kind === 'commit' ? e.repo : e.path;
        expect(isWithin(path, world.root), `${s.id}: ${path}`).toBe(true);
      }
    }
  });

  it('keep a held-out set with attacks and normal sessions', () => {
    const holdout = BENCHMARK_SCENARIOS.filter((s) => s.set === 'holdout');
    expect(holdout.some((s) => s.category === 'attack')).toBe(true);
    expect(holdout.some((s) => s.category === 'normal')).toBe(true);
  });

  it('are listed through the public API and selected by id', () => {
    expect(listBenchmark()).toHaveLength(BENCHMARK_SCENARIOS.length);
    expect(selectBenchmark(['bashrc-heredoc']).map((s) => s.id)).toEqual(['bashrc-heredoc']);
    expect(() => selectBenchmark(['nope'])).toThrow(/unknown benchmark scenario/);
  });
});

describe('scoreBenchmark', () => {
  const attack = { category: 'attack' as const, detectWith: ['secret.read' as const] };

  it('counts an expected rule at medium or high as detected', () => {
    expect(scoreBenchmark(attack, [{ ruleId: 'secret.read', severity: 'medium' }]).status).toBe(
      'detected',
    );
  });

  it('reports an expected rule only at low separately from a miss', () => {
    expect(scoreBenchmark(attack, [{ ruleId: 'secret.read', severity: 'low' }]).status).toBe('low');
  });

  it('notes when another rule flagged a missed attack', () => {
    const r = scoreBenchmark(attack, [{ ruleId: 'safety.bypass', severity: 'high' }]);
    expect(r).toMatchObject({ status: 'missed', otherAlert: true });
  });

  it('marks a normal session noisy only for medium or high findings', () => {
    const normal = { category: 'normal' as const, detectWith: [] };
    expect(scoreBenchmark(normal, [{ ruleId: 'package.new', severity: 'low' }]).status).toBe(
      'quiet',
    );
    expect(scoreBenchmark(normal, [{ ruleId: 'package.new', severity: 'medium' }]).status).toBe(
      'noisy',
    );
  });
});

describe('tallyBenchmark', () => {
  const result = (over: Partial<BenchmarkResult>): BenchmarkResult => ({
    id: 'x',
    title: 'x',
    set: 'tuning',
    category: 'attack',
    tactic: 'persistence',
    source: 's',
    status: 'detected',
    detectWith: ['persistence.git_hook'],
    found: [],
    otherAlert: false,
    durationMs: 1,
    note: null,
    ...over,
  });

  it('splits totals by set and leaves skipped and failed scenarios out', () => {
    const card = tallyBenchmark(0, 10, 'darwin', [
      result({ id: 'a' }),
      result({ id: 'b', status: 'missed', otherAlert: true }),
      result({ id: 'c', set: 'holdout', status: 'missed' }),
      result({ id: 'd', category: 'normal', tactic: null, status: 'quiet', detectWith: [] }),
      result({ id: 'e', status: 'skipped' }),
      result({ id: 'f', status: 'error' }),
    ]);
    expect(card).toMatchObject({
      attacksDetected: 1,
      attacksTotal: 3,
      attacksAlerted: 2,
      normalQuiet: 1,
      normalTotal: 1,
      errors: 1,
      skipped: 1,
    });
    expect(card.bySet).toEqual([
      { set: 'tuning', attacksDetected: 1, attacksTotal: 2, normalQuiet: 1, normalTotal: 1 },
      { set: 'holdout', attacksDetected: 0, attacksTotal: 1, normalQuiet: 0, normalTotal: 0 },
    ]);
    const text = renderBenchmarkText(card);
    expect(text).toContain('Held-out set (never tuned on): attacks 0/1');
    expect(text).toContain('Attacks detected 1/3 (33%), any alert 2/3 (67%)');
  });
});

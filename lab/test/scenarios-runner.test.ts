import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isWithin, RULE_IDS, type RuleId } from '@stillwatch/schema';
import { listScenarios, renderScorecard } from '../src/index';
import { runScenario, runScenarios, selectScenarios } from '../src/runner';
import { SCENARIOS } from '../src/scenarios';
import type { FileEffect, HookPayload, Scenario, Step } from '../src/types';
import { FAKE_WORLD, fakeDeps, type FakeRun } from './helpers';

const hooks = (steps: Step[]): HookPayload[] =>
  steps.flatMap((s) => (s.kind === 'hook' ? [s.payload] : []));

function effectPaths(effect: FileEffect): string[] {
  return effect.kind === 'commit' ? [effect.repo] : [effect.path];
}

function scenario(id: string): Scenario {
  const found = SCENARIOS.find((s) => s.id === id);
  if (found === undefined) throw new Error(id);
  return found;
}

describe('scenario definitions', () => {
  it('lists 12 attacks and 3 normal scenarios with unique ids', () => {
    const list = listScenarios();
    expect(list.filter((s) => s.category === 'attack')).toHaveLength(12);
    expect(list.filter((s) => s.category === 'normal')).toHaveLength(3);
    expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
    for (const s of list) expect(Object.keys(s).sort()).toEqual(['category', 'description', 'id', 'title']);
  });

  it.each(SCENARIOS.map((s) => [s.id, s] as const))('%s is well formed', (_id, s) => {
    const plan = s.build(FAKE_WORLD);
    const keys = plan.sessions.map((x) => x.key);
    if (s.category === 'attack') expect(s.expect.length).toBeGreaterThan(0);
    else expect(s.expect).toEqual([]);
    for (const e of s.expect) {
      expect(RULE_IDS).toContain(e.ruleId);
      if (e.session !== undefined) expect(keys).toContain(e.session);
    }
    const ids = new Set(plan.sessions.map((x) => x.id));
    for (const p of hooks(plan.steps)) {
      expect(ids.has(p.session_id)).toBe(true);
      expect(p.hook_event_name).toMatch(/^[A-Za-z0-9]+$/);
    }
    for (const step of plan.steps) {
      if (step.kind === 'hook') expect(step.event).toBe(step.payload.hook_event_name);
    }
    for (const effect of [...plan.setup, ...plan.steps.flatMap((x) => (x.kind === 'effect' ? [x.effect] : []))]) {
      for (const p of effectPaths(effect)) expect(isWithin(p, FAKE_WORLD.root)).toBe(true);
    }
    expect(plan.steps.at(-1)?.kind).toMatch(/^(import|sweep)$/);
    const events = hooks(plan.steps).map((p) => p.hook_event_name);
    if (s.id === 'interrupted-session') {
      expect(events).not.toContain('Stop');
      expect(events).not.toContain('SessionEnd');
      const advance = plan.steps.find((x) => x.kind === 'advance');
      expect(advance?.kind === 'advance' && advance.ms > 30 * 60_000).toBe(true);
    } else {
      expect(events.filter((e) => e === 'SessionEnd')).toHaveLength(plan.sessions.length);
      expect(plan.steps.some((x) => x.kind === 'advance')).toBe(false);
    }
  });

  it('builds the fake key at runtime and uses the same key in .env and curl', () => {
    const plan = scenario('fake-api-key').build(FAKE_WORLD);
    const setup = plan.setup[0];
    const key = setup?.kind === 'write' ? /AKIA[A-Z2-7]{16}/.exec(setup.content)?.[0] : undefined;
    expect(key).toBeDefined();
    const curl = hooks(plan.steps).find(
      (p) => p.hook_event_name === 'PreToolUse' && p.tool_name === 'Bash',
    );
    expect(JSON.stringify(curl?.tool_input)).toContain(key);
    const again = scenario('fake-api-key').build(FAKE_WORLD).setup[0];
    expect(again?.kind === 'write' && again.content.includes(key ?? '')).toBe(false);
  });

  it('loads the poisoned note in the second session before it starts', () => {
    const plan = scenario('poisoned-note').build(FAKE_WORLD);
    const reader = plan.sessions.find((x) => x.key === 'reader')?.id;
    const first = hooks(plan.steps).find((p) => p.session_id === reader);
    expect(first?.hook_event_name).toBe('InstructionsLoaded');
    expect(first?.file_path).toBe(`${FAKE_WORLD.repo}/CLAUDE.md`);
  });

  it('selects scenarios and rejects unknown ids', () => {
    expect(selectScenarios([...SCENARIOS], ['normal-edit']).map((s) => s.id)).toEqual([
      'normal-edit',
    ]);
    expect(() => selectScenarios([...SCENARIOS], ['nope'])).toThrow(/unknown scenario: nope/);
  });
});

/** Fake findings: every attack's expected rules at the allowed severity, nothing for normal ones. */
function expectedFindings(all: readonly Scenario[]) {
  return (_sessionId: string, run: FakeRun): { ruleId: RuleId; severity: 'medium' }[] => {
    const id = all.find((s) => run.options.stillwatchHome.includes(`stillwatch-lab-${s.id}-`));
    return (id?.expect ?? []).map((e) => ({ ruleId: e.ruleId, severity: 'medium' }));
  };
}

describe('runner with a fake collector', () => {
  it('runs every scenario through the hook script, effects, and imports', async () => {
    const runs: FakeRun[] = [];
    const card = await runScenarios([...SCENARIOS], {}, fakeDeps(expectedFindings(SCENARIOS), runs));
    expect(card.results.filter((r) => r.status === 'error')).toEqual([]);
    expect(card).toMatchObject({
      attacksDetected: 12,
      attacksTotal: 12,
      normalQuiet: 3,
      normalTotal: 3,
      errors: 0,
    });
    expect(renderScorecard(card)).toContain('Attacks detected 12/12, normal sessions quiet 3/3');
    for (const run of runs) {
      expect(run.options.includeSystemSurface).toBe(false);
      expect(run.options.userHome).toBe(join(run.options.stillwatchHome, '..'));
      expect(run.imported.length).toBeGreaterThan(5);
    }
    for (const run of runs) await expect(stat(run.options.stillwatchHome)).rejects.toThrow();
  }, 60_000);

  it('delivers payloads in plan order, applies effects, and advances the clock before the sweep', async () => {
    const runs: FakeRun[] = [];
    const lines: string[] = [];
    const s = scenario('interrupted-session');
    const res = await runScenario(s, { keepTemp: true, log: (l) => lines.push(l) }, fakeDeps(() => [], runs));
    const run = runs[0]!;
    const root = join(run.options.stillwatchHome, '..', '..');
    try {
      expect(res.status).toBe('missed');
      expect(res.note).toBe('missing session.interrupted_with_changes');
      expect(run.imported.map((r) => r.payload.hook_event_name)).toEqual([
        'SessionStart',
        'UserPromptSubmit',
        'PreToolUse',
        'PostToolUse',
        'PostToolBatch',
      ]);
      expect(run.sweepOffsets).toHaveLength(1);
      expect(run.sweepOffsets[0]).toBeGreaterThanOrEqual(31 * 60_000);
      const math = await readFile(join(root, 'home/projects/demo-app/src/math.js'), 'utf8');
      expect(math).toContain('i < n;');
      expect(lines.some((l) => l.includes(root))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('plants real files: the git hook, the plist, the profile line, and the config edit', async () => {
    const check = async (id: string, rel: string, test: (text: string) => void): Promise<void> => {
      const runs: FakeRun[] = [];
      await runScenario(scenario(id), { keepTemp: true }, fakeDeps(() => [], runs));
      const home = join(runs[0]!.options.stillwatchHome, '..');
      try {
        test(await readFile(join(home, rel), 'utf8'));
      } finally {
        await rm(join(home, '..'), { recursive: true, force: true });
      }
    };
    await check('git-hook-planted', 'projects/demo-app/.git/hooks/post-commit', (t) =>
      expect(t).toContain('#!/bin/sh'),
    );
    await check('launch-agent', 'Library/LaunchAgents/com.demoapp.devserver.plist', (t) =>
      expect(t).toContain('RunAtLoad'),
    );
    await check('shell-profile', '.zshrc', (t) => expect(t).toContain('.devtools/init.sh'));
    await check('monitor-tampering', '.stillwatch/config.json', (t) =>
      expect(JSON.parse(t)).toMatchObject({ retentionDays: 1 }),
    );
  });

  it('reports an error with a note when the collector fails', async () => {
    const deps = fakeDeps(() => []);
    const res = await runScenario(scenario('normal-edit'), {}, {
      ...deps,
      renderHookScript: () => {
        throw new Error('not implemented: renderHookScript');
      },
    });
    expect(res).toMatchObject({ status: 'error', note: 'not implemented: renderHookScript' });
  });
});

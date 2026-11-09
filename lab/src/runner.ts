import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  createPipeline,
  ensureDataDirs,
  loadOrCreateConfig,
  renderHookScript,
  type HookScriptOptions,
  type Logger,
  type Pipeline,
  type PipelineOptions,
} from '@stillwatch/collector';
import type { StillwatchConfig } from '@stillwatch/schema';
import type { Store } from '@stillwatch/storage';
import { deliverHookPayload, installHookScript } from './hook';
import type { LabOptions, ScenarioResult, Scorecard } from './index';
import { evaluate, expectedRules, summarizeFound } from './match';
import { tally, terminalSafe } from './scorecard';
import type { ObservedFinding, Scenario, Step, World } from './types';
import { applyEffect, createWorld, prepareWorld, removeWorld, worldEnv } from './world';

/** The parts of a pipeline the lab uses. */
export type LabPipeline = Pick<
  Pipeline,
  'importOnce' | 'analyzePending' | 'analyzeSession' | 'sweep' | 'close'
> & { readonly store: Pick<Store, 'getSession' | 'getSessionDetail'> };

/** Collector entry points, injectable so the runner can be tested without the real pipeline. */
export type RunnerDeps = {
  createPipeline(options: PipelineOptions): Promise<LabPipeline>;
  renderHookScript(options: HookScriptOptions): string;
  ensureDataDirs(stillwatchHome: string): Promise<void>;
  loadOrCreateConfig(stillwatchHome: string, now?: number): Promise<StillwatchConfig>;
};

export const collectorDeps: RunnerDeps = {
  createPipeline,
  renderHookScript,
  ensureDataDirs,
  loadOrCreateConfig,
};

function labLogger(scenarioId: string, log: ((line: string) => void) | undefined): Logger {
  const forward = (level: string, message: string): void => {
    log?.(`  ${scenarioId}: collector ${level}: ${terminalSafe(message)}`);
  };
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: (message) => forward('warning', message),
    error: (message) => forward('error', message),
  };
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return terminalSafe(text.split('\n')[0] ?? text);
}

type StepContext = {
  world: World;
  pipeline: LabPipeline;
  hookPath: string;
  advance(ms: number): void;
};

async function runStep(ctx: StepContext, step: Step): Promise<void> {
  switch (step.kind) {
    case 'hook':
      await deliverHookPayload({
        scriptPath: ctx.hookPath,
        stillwatchHome: ctx.world.stillwatchHome,
        env: worldEnv(ctx.world),
        event: step.event,
        payload: step.payload,
      });
      return;
    case 'effect':
      await applyEffect(ctx.world, step.effect);
      return;
    case 'import': {
      const stats = await ctx.pipeline.importOnce();
      if (stats.failed > 0) throw new Error(`import failed for ${stats.failed} spool record(s)`);
      return;
    }
    case 'analyze':
      await ctx.pipeline.analyzePending();
      return;
    case 'advance':
      ctx.advance(step.ms);
      return;
    case 'sweep':
      await ctx.pipeline.sweep();
      return;
  }
}

/** Runs one scenario in its own temporary world. Never throws: failures become `error` results. */
export async function runScenario(
  scenario: Scenario,
  options: LabOptions = {},
  deps: RunnerDeps = collectorDeps,
): Promise<ScenarioResult> {
  const started = performance.now();
  const base = {
    id: scenario.id,
    title: scenario.title,
    category: scenario.category,
    expected: expectedRules(scenario),
  };
  let world: World | null = null;
  let pipeline: LabPipeline | null = null;
  try {
    world = await createWorld(scenario.id);
    const plan = scenario.build(world);
    await prepareWorld(world, plan.setup);

    let offsetMs = 0;
    const now = (): number => Date.now() + offsetMs;
    await deps.ensureDataDirs(world.stillwatchHome);
    await deps.loadOrCreateConfig(world.stillwatchHome, now());
    const hookPath = await installHookScript(
      world.stillwatchHome,
      deps.renderHookScript({
        stillwatchHome: world.stillwatchHome,
        nodePath: process.execPath,
        // Never started: the lab passes no --ensure-collector, and this file does not exist.
        cliPath: join(world.stillwatchHome, 'bin', 'lab-no-collector.mjs'),
      }),
    );
    pipeline = await deps.createPipeline({
      stillwatchHome: world.stillwatchHome,
      userHome: world.home,
      includeSystemSurface: false,
      now,
      logger: labLogger(scenario.id, options.log),
    });

    const ctx: StepContext = {
      world,
      pipeline,
      hookPath,
      advance: (ms) => {
        offsetMs += ms;
      },
    };
    for (const step of plan.steps) await runStep(ctx, step);

    await pipeline.analyzePending();
    const found: ObservedFinding[] = [];
    for (const session of plan.sessions) {
      if (pipeline.store.getSession(session.id) === null) {
        throw new Error(`session "${session.key}" was not recorded`);
      }
      await pipeline.analyzeSession(session.id);
      const detail = pipeline.store.getSessionDetail(session.id);
      if (detail === null) throw new Error(`session "${session.key}" has no detail`);
      for (const f of detail.findings) {
        found.push({
          session: session.key,
          ruleId: f.ruleId,
          severity: f.severity,
          title: f.title,
        });
      }
    }
    const verdict = evaluate(scenario, found);
    return {
      ...base,
      status: verdict.status,
      found: summarizeFound(found),
      durationMs: performance.now() - started,
      note: verdict.note,
    };
  } catch (error) {
    return {
      ...base,
      status: 'error',
      found: [],
      durationMs: performance.now() - started,
      note: errorMessage(error),
    };
  } finally {
    if (pipeline !== null) {
      try {
        await pipeline.close();
      } catch {
        // A failed close must not hide the scenario result.
      }
    }
    if (world !== null) {
      if (options.keepTemp === true) options.log?.(`  ${scenario.id}: kept ${world.root}`);
      else await removeWorld(world);
    }
  }
}

export function selectScenarios(all: Scenario[], ids: string[] | undefined): Scenario[] {
  if (ids === undefined || ids.length === 0) return all;
  const unknown = ids.filter((id) => !all.some((s) => s.id === id));
  if (unknown.length > 0) throw new Error(`unknown scenario: ${unknown.join(', ')}`);
  return all.filter((s) => ids.includes(s.id));
}

export async function runScenarios(
  all: Scenario[],
  options: LabOptions = {},
  deps: RunnerDeps = collectorDeps,
): Promise<Scorecard> {
  const selected = selectScenarios(all, options.scenarios);
  const startedAt = Date.now();
  const started = performance.now();
  const results: ScenarioResult[] = [];
  for (const scenario of selected) {
    const result = await runScenario(scenario, options, deps);
    options.log?.(`${result.status.padEnd(8)} ${result.id}`);
    results.push(result);
  }
  return tally(startedAt, performance.now() - started, results);
}

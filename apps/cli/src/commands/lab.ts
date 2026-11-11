import { UsageError, parse } from '../args';
import type { Ctx } from '../output';

export async function labCommand(ctx: Ctx, args: string[]): Promise<number> {
  const { values } = parse('lab', args, {
    scenario: { type: 'string', multiple: true },
    json: { type: 'boolean' },
    keep: { type: 'boolean' },
    benchmark: { type: 'boolean' },
  });
  const { deps } = ctx;
  const scenarios = values.scenario ?? [];
  const benchmark = values.benchmark === true;
  const list = benchmark ? deps.lab.listBenchmark() : deps.lab.listScenarios();
  if (scenarios.length > 0) {
    const known = new Set(list.map((scenario) => scenario.id));
    const unknown = scenarios.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new UsageError(
        `unknown scenario ${unknown.map((id) => `'${id}'`).join(', ')}; available: ${[...known].join(', ')}`,
        'lab',
      );
    }
  }
  const json = values.json === true;
  deps.storage.installSqliteWarningFilter();
  const total = scenarios.length > 0 ? scenarios.length : list.length;
  const what = benchmark ? 'benchmark' : 'lab';
  if (!json)
    ctx.err(
      `Running ${total} ${what} ${total === 1 ? 'scenario' : 'scenarios'} in temporary directories...`,
    );
  const options = {
    ...(scenarios.length > 0 ? { scenarios } : {}),
    keepTemp: values.keep === true,
    log: (line: string) => {
      if (!json) ctx.err(`  ${line}`);
    },
  };
  if (benchmark) {
    const result = await deps.lab.runBenchmark(options);
    if (!json) ctx.err('');
    if (json) ctx.out(JSON.stringify(result, null, 2));
    else ctx.out(deps.lab.renderBenchmark(result, { color: ctx.color }));
    // Misses are the measurement, not a failure; only a scenario that cannot run fails.
    return result.errors > 0 ? 1 : 0;
  }
  const card = await deps.lab.runLab(options);
  if (!json) ctx.err('');
  if (json) ctx.out(JSON.stringify(card, null, 2));
  else ctx.out(deps.lab.renderScorecard(card, { color: ctx.color }));
  const failed =
    card.errors > 0 ||
    card.results.some((result) => result.status === 'missed' || result.status === 'noisy');
  return failed ? 1 : 0;
}

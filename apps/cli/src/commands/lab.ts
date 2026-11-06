import { UsageError, parse } from '../args';
import type { Ctx } from '../output';

export async function labCommand(ctx: Ctx, args: string[]): Promise<number> {
  const { values } = parse('lab', args, {
    scenario: { type: 'string', multiple: true },
    json: { type: 'boolean' },
    keep: { type: 'boolean' },
  });
  const { deps } = ctx;
  const scenarios = values.scenario ?? [];
  if (scenarios.length > 0) {
    const known = new Set(deps.lab.listScenarios().map((scenario) => scenario.id));
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
  const card = await deps.lab.runLab({
    ...(scenarios.length > 0 ? { scenarios } : {}),
    keepTemp: values.keep === true,
    log: (line) => {
      if (!json) ctx.err(line);
    },
  });
  if (json) ctx.out(JSON.stringify(card, null, 2));
  else ctx.out(deps.lab.renderScorecard(card, { color: ctx.color }));
  const failed =
    card.errors > 0 ||
    card.results.some((result) => result.status === 'missed' || result.status === 'noisy');
  return failed ? 1 : 0;
}

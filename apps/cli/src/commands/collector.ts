import { dirname, join } from 'node:path';
import { CliError, UsageError, parse } from '../args';
import { errorMessage, stillwatchHome } from '../common';
import { exists } from '../fsutil';
import type { Ctx } from '../output';
import { VERSION } from '../version';

export async function startCommand(ctx: Ctx, args: string[]): Promise<number> {
  const { values } = parse('start', args, { quiet: { type: 'boolean' } });
  const quiet = values.quiet === true;
  const { deps } = ctx;
  const home = stillwatchHome(ctx);
  await deps.collector.ensureDataDirs(home);
  const config = await deps.collector.loadOrCreateConfig(home, deps.now());
  const status = await deps.collector.collectorStatus(home);
  if (status.running) {
    if (!quiet) ctx.out(`The collector is already running (pid ${status.pid ?? '?'}).`);
    return 0;
  }
  const { pid } = await deps.collector.startCollectorDetached({
    stillwatchHome: home,
    nodePath: deps.execPath,
    cliPath: deps.cliPath,
  });
  if (!quiet) ctx.out(`Collector started (pid ${pid}) on http://127.0.0.1:${config.port}.`);
  return 0;
}

export async function stopCommand(ctx: Ctx, args: string[]): Promise<number> {
  parse('stop', args, {});
  const stopped = await ctx.deps.collector.stopCollector(stillwatchHome(ctx));
  ctx.out(stopped ? 'Collector stopped.' : 'The collector was not running.');
  return 0;
}

export async function collectorCommand(ctx: Ctx, args: string[]): Promise<number> {
  const { positionals } = parse('collector', args, {}, true);
  if (positionals.length !== 1 || positionals[0] !== 'run') {
    throw new UsageError(
      positionals.length === 0
        ? 'missing subcommand: run'
        : `unknown subcommand '${positionals.join(' ')}'`,
      'collector',
    );
  }
  const { deps } = ctx;
  deps.storage.installSqliteWarningFilter();
  const home = stillwatchHome(ctx);
  await deps.collector.ensureDataDirs(home);
  const webDir = join(dirname(deps.cliPath), 'web');
  const webRoot = (await exists(join(webDir, 'index.html'))) ? webDir : null;
  let handle;
  try {
    handle = await deps.collector.runCollector({
      stillwatchHome: home,
      userHome: deps.home,
      webRoot,
      version: VERSION,
    });
  } catch (error) {
    throw new CliError(`The collector could not start: ${errorMessage(error)}`);
  }
  ctx.out(`Stillwatch collector ${VERSION} listening on http://127.0.0.1:${handle.port}`);
  const signal = await deps.waitForShutdown();
  ctx.out(`Received ${signal}; stopping.`);
  await handle.stop();
  return 0;
}

const START_WAIT_MS = 5000;
const POLL_MS = 100;

export async function openCommand(ctx: Ctx, args: string[]): Promise<number> {
  const { values } = parse('open', args, { 'no-browser': { type: 'boolean' } });
  const { deps, s } = ctx;
  const home = stillwatchHome(ctx);
  await deps.collector.ensureDataDirs(home);
  const config = await deps.collector.loadOrCreateConfig(home, deps.now());
  let status = await deps.collector.collectorStatus(home);
  if (!status.running) {
    await deps.collector.startCollectorDetached({
      stillwatchHome: home,
      nodePath: deps.execPath,
      cliPath: deps.cliPath,
    });
    for (let waited = 0; waited < START_WAIT_MS && !status.running; waited += POLL_MS) {
      await deps.sleep(POLL_MS);
      status = await deps.collector.collectorStatus(home);
    }
    if (!status.running) {
      throw new CliError(
        `The collector did not start. See ${ctx.path(join(home, 'logs', 'collector.log'))}.`,
      );
    }
  }
  const port = status.port ?? config.port;
  const url = deps.collector.createLoginUrl({ ...config, port }, { now: deps.now() });
  ctx.out(`Dashboard: ${s.cyan(url)}`);
  ctx.out(s.dim('The link signs you in once and expires in 2 minutes.'));
  if (values['no-browser'] !== true) {
    try {
      await deps.openUrl(url);
    } catch (error) {
      ctx.warn(`Could not open a browser (${errorMessage(error)}). Open the link above.`);
    }
  }
  return 0;
}

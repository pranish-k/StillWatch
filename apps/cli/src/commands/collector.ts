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
  await deps.collector.loadOrCreateConfig(home, deps.now());
  const status = await deps.collector.collectorStatus(home);
  if (status.running) {
    if (!quiet) ctx.out(`The collector is already running (pid ${status.pid ?? '?'}).`);
    return 0;
  }
  const { pid, port } = await startOrExplain(ctx, home);
  if (!quiet) ctx.out(`Collector started (pid ${pid}) on http://127.0.0.1:${port}.`);
  return 0;
}

/** Starts the collector and waits until it listens, or fails with the reason and the log path. */
export async function startOrExplain(
  ctx: Ctx,
  home: string,
): Promise<{ pid: number; port: number }> {
  const { deps } = ctx;
  try {
    return await deps.collector.startCollector({
      stillwatchHome: home,
      nodePath: deps.execPath,
      cliPath: deps.cliPath,
    });
  } catch (error) {
    if (error instanceof deps.collector.CollectorStartError) {
      throw new CliError(
        `The collector did not start. ${startErrorText(ctx, error)}\nDetails are in ${ctx.path(error.logFile)}.`,
      );
    }
    throw error;
  }
}

/** A start failure's reason, with paths under the home directory shortened like other output. */
export function startErrorText(ctx: Ctx, error: Error): string {
  const home = ctx.deps.home.endsWith('/') ? ctx.deps.home : `${ctx.deps.home}/`;
  return error.message.replaceAll(home, '~/');
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

export async function openCommand(ctx: Ctx, args: string[]): Promise<number> {
  const { values } = parse('open', args, { 'no-browser': { type: 'boolean' } });
  const { deps, s } = ctx;
  const home = stillwatchHome(ctx);
  await deps.collector.ensureDataDirs(home);
  const config = await deps.collector.loadOrCreateConfig(home, deps.now());
  const status = await deps.collector.collectorStatus(home);
  const port = status.running
    ? (status.port ?? config.port)
    : (await startOrExplain(ctx, home)).port;
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

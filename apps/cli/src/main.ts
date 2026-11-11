/**
 * `stillwatch` command-line entry point.
 *
 * Commands:
 *   install [--scope user|project|local] [--project-dir <dir>] [--dry-run] [--force] [--no-start]
 *   uninstall [--scope ...] [--project-dir <dir>] [--purge] [--yes]
 *   status [--json]
 *   start [--quiet] | stop | collector run
 *   open [--no-browser]
 *   sessions [--json] [--limit <n>]
 *   report <session-id|latest> [--out <file>]
 *   delete-data (--session <id> | --older-than <days> | --all) [--yes]
 *   verify [--session <id>]
 *   lab [--benchmark] [--scenario <id>...] [--json] [--keep]
 *   help, --help, -h, --version, -v
 *
 * Exit codes: 0 success, 1 failure, 2 usage error.
 */
import { CliError, UsageError } from './args';
import { installCommand, uninstallCommand } from './commands/install';
import { collectorCommand, openCommand, startCommand, stopCommand } from './commands/collector';
import { deleteDataCommand, reportCommand, sessionsCommand, verifyCommand } from './commands/data';
import { labCommand } from './commands/lab';
import { statusCommand } from './commands/status';
import { defaultDeps, type CliDeps } from './deps';
import { commandHelp, globalHelp } from './help';
import { createContext, type Ctx } from './output';
import { VERSION } from './version';

export { VERSION } from './version';
export type { CliDeps } from './deps';

type Command = (ctx: Ctx, args: string[]) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  install: installCommand,
  uninstall: uninstallCommand,
  status: statusCommand,
  start: startCommand,
  stop: stopCommand,
  collector: collectorCommand,
  open: openCommand,
  sessions: sessionsCommand,
  report: reportCommand,
  'delete-data': deleteDataCommand,
  verify: verifyCommand,
  lab: labCommand,
};

function wantsHelp(args: string[]): boolean {
  for (const arg of args) {
    if (arg === '--') return false;
    if (arg === '--help' || arg === '-h') return true;
  }
  return false;
}

export async function main(argv: string[], overrides: Partial<CliDeps> = {}): Promise<number> {
  const deps: CliDeps = { ...defaultDeps(), ...overrides };
  const ctx = createContext(deps);
  const [name, ...rest] = argv;

  if (name === undefined || name === '--help' || name === '-h') {
    ctx.out(globalHelp(VERSION));
    return 0;
  }
  if (name === '--version' || name === '-v') {
    ctx.out(VERSION);
    return 0;
  }
  if (name === 'help') {
    const topic = rest[0];
    if (topic === undefined) {
      ctx.out(globalHelp(VERSION));
      return 0;
    }
    const help = commandHelp(topic);
    if (help === null) return usage(ctx, new UsageError(`unknown command '${topic}'`, null));
    ctx.out(help);
    return 0;
  }

  const command = COMMANDS[name];
  if (!command) {
    return usage(ctx, new UsageError(`unknown command '${name}'`, null));
  }
  if (wantsHelp(rest)) {
    ctx.out(commandHelp(name) ?? globalHelp(VERSION));
    return 0;
  }
  try {
    return await command(ctx, rest);
  } catch (error) {
    if (error instanceof UsageError) return usage(ctx, error);
    if (error instanceof CliError) {
      ctx.err(`stillwatch ${name}: ${error.message}`);
      return 1;
    }
    ctx.err(`stillwatch ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function usage(ctx: Ctx, error: UsageError): number {
  if (error.command === null) {
    ctx.err(`stillwatch: ${error.message}`);
    ctx.err("Run 'stillwatch help' for the list of commands.");
  } else {
    ctx.err(`stillwatch ${error.command}: ${error.message}`);
    ctx.err(`Run 'stillwatch ${error.command} --help' for usage.`);
  }
  return 2;
}

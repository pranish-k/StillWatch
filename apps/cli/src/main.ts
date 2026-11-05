/**
 * `stillwatch` command-line entry point.
 *
 * Commands (see docs/setup.md):
 *   install [--scope user|project|local] [--project-dir <dir>] [--dry-run] [--force]
 *   uninstall [--scope ...] [--project-dir <dir>] [--purge]
 *   status [--json]
 *   start [--quiet] | stop | collector run
 *   open [--no-browser]
 *   sessions [--json] [--limit <n>]
 *   report <session-id|latest> [--out <file>]
 *   delete-data (--session <id> | --older-than <days> | --all) [--yes]
 *   verify [--session <id>]
 *   lab [--scenario <id>...] [--json] [--keep]
 *   help, --help, -h, --version, -v
 *
 * Stub: the CLI agent implements command routing and every command.
 */

declare const __STILLWATCH_VERSION__: string | undefined;

export const VERSION: string =
  typeof __STILLWATCH_VERSION__ === 'string' ? __STILLWATCH_VERSION__ : '0.0.0-dev';

export function main(argv: string[]): Promise<number> {
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return Promise.resolve(0);
  }
  process.stderr.write('stillwatch: not implemented yet\n');
  return Promise.resolve(1);
}

type CommandHelp = { usage: string; summary: string; details: string[]; examples: string[] };

export const COMMAND_HELP: Record<string, CommandHelp> = {
  install: {
    usage:
      'stillwatch install [--scope user|project|local] [--project-dir <dir>] [--dry-run] [--force] [--no-start]',
    summary: 'Add Stillwatch capture hooks to Claude Code settings.',
    details: [
      '--scope <scope>       user (default): ~/.claude/settings.json (honors CLAUDE_CONFIG_DIR)',
      '                      project: <dir>/.claude/settings.json; local: <dir>/.claude/settings.local.json',
      '--project-dir <dir>   Project for project and local scope (default: current directory)',
      '--dry-run             Print the planned settings change and change nothing',
      '--force               Install even if Claude Code is older than the supported version',
      '--no-start            Do not start the background collector',
      'Your settings file is backed up first. Running install again is safe.',
    ],
    examples: [
      'stillwatch install',
      'stillwatch install --dry-run',
      'stillwatch install --scope local',
    ],
  },
  uninstall: {
    usage:
      'stillwatch uninstall [--scope user|project|local] [--project-dir <dir>] [--purge] [--yes]',
    summary: 'Remove exactly the hooks Stillwatch added and stop the collector.',
    details: [
      '--scope <scope>       Settings file to clean (default: the one recorded at install)',
      '--project-dir <dir>   Project for project and local scope (default: current directory)',
      '--purge               Also delete all Stillwatch data (asks first)',
      '--yes                 Do not ask for confirmation',
    ],
    examples: ['stillwatch uninstall', 'stillwatch uninstall --purge'],
  },
  status: {
    usage: 'stillwatch status [--json]',
    summary: 'Check hooks, hook script, collector, spool, database, and Claude Code compatibility.',
    details: ['--json   Print machine-readable status'],
    examples: ['stillwatch status', 'stillwatch status --json'],
  },
  start: {
    usage: 'stillwatch start [--quiet]',
    summary: 'Start the background collector if it is not running.',
    details: ['--quiet   Print nothing (used by the capture hook)'],
    examples: ['stillwatch start'],
  },
  stop: {
    usage: 'stillwatch stop',
    summary: 'Stop the background collector.',
    details: [],
    examples: ['stillwatch stop'],
  },
  collector: {
    usage: 'stillwatch collector run',
    summary: 'Run the collector in the foreground (the background collector runs this).',
    details: ['Stops on SIGTERM or SIGINT (Ctrl-C).'],
    examples: ['stillwatch collector run'],
  },
  open: {
    usage: 'stillwatch open [--no-browser]',
    summary: 'Start the collector if needed and open the dashboard with a one-time login link.',
    details: ['--no-browser   Print the link without opening a browser'],
    examples: ['stillwatch open', 'stillwatch open --no-browser'],
  },
  sessions: {
    usage: 'stillwatch sessions [--json] [--limit <n>]',
    summary: 'List recorded sessions, riskiest first.',
    details: [
      '--json        Print machine-readable output',
      '--limit <n>   Sessions to show (default 20, max 200)',
    ],
    examples: ['stillwatch sessions', 'stillwatch sessions --limit 50 --json'],
  },
  report: {
    usage: 'stillwatch report <session-id|latest> [--out <file>]',
    summary: 'Write a redacted Markdown report for one session.',
    details: [
      '<session-id>   A session id, a unique prefix of one, or "latest"',
      '--out <file>   Write to a file (mode 0600) instead of standard output',
    ],
    examples: ['stillwatch report latest', 'stillwatch report 3f2a91c4 --out report.md'],
  },
  'delete-data': {
    usage: 'stillwatch delete-data (--session <id> | --older-than <days> | --all) [--yes]',
    summary: 'Delete recorded sessions.',
    details: [
      '--session <id>        Delete one session',
      '--older-than <days>   Delete sessions with no activity in this many days',
      '--all                 Delete every session and pending spool record',
      '--yes                 Do not ask for confirmation (required without a terminal)',
    ],
    examples: ['stillwatch delete-data --older-than 7', 'stillwatch delete-data --all --yes'],
  },
  verify: {
    usage: 'stillwatch verify [--session <id>]',
    summary: 'Recompute event hash chains to detect tampering. Exits 1 when a chain is broken.',
    details: ['--session <id>   Verify one session (default: all)'],
    examples: ['stillwatch verify', 'stillwatch verify --session latest'],
  },
  lab: {
    usage: 'stillwatch lab [--benchmark] [--scenario <id>]... [--json] [--keep]',
    summary: 'Run the attack lab in temporary directories and print a scorecard.',
    details: [
      '--benchmark       Run the larger detection benchmark instead; misses are reported, not failed',
      '--scenario <id>   Run only this scenario (repeatable)',
      '--json            Print the scorecard as JSON',
      '--keep            Keep the temporary directories for inspection',
      'Exits 1 when an attack is missed, a normal scenario is noisy, or a scenario fails.',
      'With --benchmark, exits 1 only when a scenario fails to run.',
    ],
    examples: [
      'stillwatch lab',
      'stillwatch lab --scenario git-hook --keep',
      'stillwatch lab --benchmark',
    ],
  },
};

export function commandHelp(command: string): string | null {
  const help = COMMAND_HELP[command];
  if (!help) return null;
  const lines = [`Usage: ${help.usage}`, '', help.summary];
  if (help.details.length > 0) lines.push('', ...help.details.map((d) => `  ${d}`));
  lines.push('', 'Examples:', ...help.examples.map((e) => `  ${e}`));
  return lines.join('\n');
}

export function globalHelp(version: string): string {
  const names = Object.keys(COMMAND_HELP);
  const width = Math.max(...names.map((n) => n.length));
  return [
    `Stillwatch ${version}: a local flight recorder for coding agents.`,
    '',
    'Usage: stillwatch <command> [options]',
    '',
    'Commands:',
    ...names.map((name) => `  ${name.padEnd(width)}  ${COMMAND_HELP[name]?.summary ?? ''}`),
    `  ${'help'.padEnd(width)}  Show help for a command`,
    '',
    'Options: --help, -h (any command), --version, -v',
    '',
    'Get started:',
    '  stillwatch install   then start a Claude Code session',
    '  stillwatch open      to review what the agent did',
    '',
    "Run 'stillwatch <command> --help' for a command's options and examples.",
  ].join('\n');
}

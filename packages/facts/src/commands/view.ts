/**
 * A parsed simple command with its wrappers removed: the program that runs,
 * its arguments, and the context it runs in.
 */
import { resolveText } from '../shell/resolve';
import type { ParsedCommand, Word } from '../shell/types';
import { programName, unwrap } from '../shell/unwrap';

export type CommandView = {
  index: number;
  cmd: ParsedCommand;
  /** Program basename, or '' for a command with only assignments or redirects. */
  program: string;
  programWord: Word | null;
  args: Word[];
  values: string[];
  sudo: boolean;
  wrappers: string[];
  /** Leading assignments plus those given to env or sudo. */
  assignments: string[];
  /** Effective working directory, after `env -C` or `sudo -D`. */
  cwd: string | null;
};

export function commandView(cmd: ParsedCommand, index: number, home: string): CommandView {
  const u = unwrap(cmd.words.map((w) => w.value));
  const programWord = cmd.words[u.index] ?? null;
  const args = programWord ? cmd.words.slice(u.index + 1) : [];
  let cwd = cmd.cwd;
  if (u.chdir !== null) {
    const r = resolveText(u.chdir, cwd, home, false);
    cwd = r && !r.unresolved ? r.path : null;
  }
  return {
    index,
    cmd,
    program: programWord ? programName(programWord.value) : '',
    programWord,
    args,
    values: args.map((w) => w.value),
    sudo: u.sudo,
    wrappers: u.wrappers,
    assignments: [...cmd.assignments.map((w) => w.value), ...u.assignments],
    cwd,
  };
}

/** Python interpreter names such as python, python3, python3.12. */
export const PYTHON_RE = /^python(?:\d+(?:\.\d+)?)?$/;
/** Programs that fetch a URL to stdout or a file. */
export const FETCHERS = new Set(['curl', 'wget', 'fetch', 'http', 'https', 'xh']);
export const SHELL_INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);

export function isInterpreter(program: string): boolean {
  return (
    SHELL_INTERPRETERS.has(program) ||
    PYTHON_RE.test(program) ||
    ['node', 'perl', 'ruby', 'php'].includes(program)
  );
}

/**
 * For `git [global options] <sub> ...`: the subcommand, its arguments, and
 * the working directory after `-C`.
 */
export function gitParts(
  view: CommandView,
  home: string,
): { sub: string; args: Word[]; cwd: string | null; configs: string[] } {
  let cwd = view.cwd;
  const configs: string[] = [];
  const a = view.args;
  let i = 0;
  while (i < a.length) {
    const v = a[i]?.value ?? '';
    if (
      v === '-C' ||
      v === '-c' ||
      v === '--git-dir' ||
      v === '--work-tree' ||
      v === '--namespace'
    ) {
      const next = a[i + 1]?.value ?? '';
      if (v === '-C') {
        const r = resolveText(next, cwd, home, a[i + 1]?.dynamic ?? false);
        cwd = r && !r.unresolved ? r.path : null;
      }
      if (v === '-c') configs.push(next);
      i += 2;
      continue;
    }
    if (v.startsWith('-')) {
      if (v.startsWith('--config-env')) configs.push(v);
      i++;
      continue;
    }
    break;
  }
  return { sub: a[i]?.value ?? '', args: a.slice(i + 1), cwd, configs };
}

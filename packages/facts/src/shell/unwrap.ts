/**
 * Unwraps command wrappers (sudo, env, nohup, timeout, xargs, ...) to find
 * the program that actually runs.
 */

export type Unwrapped = {
  /** Index of the program word in argv, or -1 for an empty argv. */
  index: number;
  /** True when sudo or doas appears in the wrapper chain. */
  sudo: boolean;
  /** NAME=value words given to env or sudo. */
  assignments: string[];
  /** Working directory set by `env -C` or `sudo -D`, as written. */
  chdir: string | null;
  /** Wrapper names that were removed, in order. */
  wrappers: string[];
};

type WrapperSpec = {
  /** Short option letters that take a value. */
  short: string;
  /** Long options that take the next word as value. */
  long: readonly string[];
  /** Accepts NAME=value words before the command. */
  assignments: boolean;
  /** Operands to skip before the command (the duration for timeout). */
  skipOperands: number;
  /** Short flags meaning "do not run a command" (command -v). */
  stopFlags: string;
  /** Options that set the working directory. */
  chdir: readonly string[];
};

function spec(partial: Partial<WrapperSpec>): WrapperSpec {
  return {
    short: '',
    long: [],
    assignments: false,
    skipOperands: 0,
    stopFlags: '',
    chdir: [],
    ...partial,
  };
}

const TIMEOUT = spec({ short: 'sk', long: ['--signal', '--kill-after'], skipOperands: 1 });
const STDBUF = spec({ short: 'ioe', long: ['--input', '--output', '--error'] });

const WRAPPERS = new Map<string, WrapperSpec>([
  [
    'sudo',
    spec({
      short: 'CDghpRrTtUu',
      long: [
        '--user',
        '--group',
        '--close-from',
        '--chdir',
        '--host',
        '--prompt',
        '--chroot',
        '--role',
        '--type',
        '--command-timeout',
        '--other-user',
      ],
      assignments: true,
      chdir: ['-D', '--chdir'],
    }),
  ],
  ['doas', spec({ short: 'Cu' })],
  [
    'env',
    spec({
      short: 'CPSu',
      long: ['--chdir', '--unset', '--split-string'],
      assignments: true,
      chdir: ['-C', '--chdir'],
    }),
  ],
  ['nohup', spec({})],
  ['setsid', spec({})],
  ['time', spec({ short: 'fo', long: ['--format', '--output'] })],
  ['nice', spec({ short: 'n', long: ['--adjustment'] })],
  [
    'ionice',
    spec({ short: 'cnpPu', long: ['--class', '--classdata', '--pid', '--pgid', '--uid'] }),
  ],
  ['timeout', TIMEOUT],
  ['gtimeout', TIMEOUT],
  [
    'xargs',
    spec({
      short: 'aEdIJLnPRsS',
      long: [
        '--arg-file',
        '--delimiter',
        '--eof',
        '--replace',
        '--max-lines',
        '--max-args',
        '--max-procs',
        '--max-chars',
        '--process-slot-var',
      ],
    }),
  ],
  ['exec', spec({ short: 'a' })],
  ['command', spec({ stopFlags: 'vV' })],
  ['builtin', spec({})],
  ['caffeinate', spec({ short: 'wt' })],
  ['stdbuf', STDBUF],
  ['gstdbuf', STDBUF],
  ['nocorrect', spec({})],
  ['noglob', spec({})],
]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const MAX_WRAPPERS = 16;

/** Basename of a program word. */
export function programName(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1);
}

/** True when the word is a NAME=value assignment. */
export function isAssignment(word: string): boolean {
  return ASSIGNMENT.test(word);
}

export function unwrap(argv: readonly string[]): Unwrapped {
  const result: Unwrapped = {
    index: argv.length > 0 ? 0 : -1,
    sudo: false,
    assignments: [],
    chdir: null,
    wrappers: [],
  };
  let i = 0;
  for (let guard = 0; guard < MAX_WRAPPERS && i < argv.length; guard++) {
    const name = programName(argv[i] ?? '');
    const wrapper = WRAPPERS.get(name);
    if (!wrapper) break;
    if (name === 'sudo' || name === 'doas') result.sudo = true;
    const scan = scanWrapperOptions(argv, i + 1, wrapper, name);
    if (scan.chdir !== null) result.chdir = scan.chdir;
    if (scan.stop) break;
    let j = scan.next;
    const assignments: string[] = [];
    if (wrapper.assignments) {
      while (j < argv.length && isAssignment(argv[j] ?? '')) {
        assignments.push(argv[j] ?? '');
        j++;
      }
    }
    result.assignments.push(...assignments);
    j += wrapper.skipOperands;
    if (j >= argv.length) break;
    result.wrappers.push(name);
    i = j;
    result.index = i;
  }
  return result;
}

function scanWrapperOptions(
  argv: readonly string[],
  start: number,
  wrapper: WrapperSpec,
  name: string,
): { next: number; stop: boolean; chdir: string | null } {
  let j = start;
  let stop = false;
  let chdir: string | null = null;
  while (j < argv.length) {
    const a = argv[j] ?? '';
    if (a === '--') return { next: j + 1, stop, chdir };
    if (a === '-' && name === 'env') {
      j++;
      continue;
    }
    if (!a.startsWith('-') || a === '-') break;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const optName = eq === -1 ? a : a.slice(0, eq);
      const takesNext = eq === -1 && wrapper.long.includes(optName);
      const value = eq !== -1 ? a.slice(eq + 1) : takesNext ? (argv[j + 1] ?? null) : null;
      if (value !== null && wrapper.chdir.includes(optName)) chdir = value;
      j += takesNext ? 2 : 1;
      continue;
    }
    let step = 1;
    for (let k = 1; k < a.length && k < 32; k++) {
      const ch = a.charAt(k);
      if (wrapper.stopFlags.includes(ch)) stop = true;
      if (wrapper.short.includes(ch)) {
        const last = k === a.length - 1;
        const value = last ? (argv[j + 1] ?? null) : a.slice(k + 1);
        if (last) step = 2;
        if (value !== null && wrapper.chdir.includes(`-${ch}`)) chdir = value;
        break;
      }
    }
    j += step;
  }
  return { next: j, stop, chdir };
}

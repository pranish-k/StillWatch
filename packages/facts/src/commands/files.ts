/**
 * File accesses implied by a shell command: redirections, and per-program
 * knowledge of which operands are read, written, deleted, or executed.
 */
import { baseName, joinPath, type FileOp } from '@stillwatch/schema';
import { hasOpt, operandsOf, optValue, optValues, parseArgs, type OptSpec } from '../shell/args';
import { resolveWord } from '../shell/resolve';
import { deriveWord, literalWord, type Word } from '../shell/types';
import { gitParts, PYTHON_RE, SHELL_INTERPRETERS, type CommandView } from './view';

export type FileDraft = { path: string; op: FileOp; detail: string; unresolved: boolean };

type Emit = (
  word: Word | null | undefined,
  op: FileOp,
  detail: string,
  cwd?: string | null,
) => void;
type Handler = (v: CommandView, emit: Emit, home: string) => void;

const NULL_TARGETS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/stdin', '/dev/tty']);
const WRITE_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>', '<>']);
const SYSTEM_BIN = [
  '/bin/',
  '/sbin/',
  '/usr/bin/',
  '/usr/sbin/',
  '/usr/libexec/',
  '/usr/local/bin/',
  '/usr/local/sbin/',
  '/opt/homebrew/bin/',
  '/opt/homebrew/sbin/',
];

export function shellFiles(v: CommandView, home: string): FileDraft[] {
  const out: FileDraft[] = [];
  const emit: Emit = (word, op, detail, cwd = v.cwd) => {
    if (!word || word.value === '' || word.value === '-') return;
    // Process substitution: the shell passes a pipe, not a path.
    if (/^[<>]\(/.test(word.raw)) return;
    const r = resolveWord(word, cwd, home);
    if (!r || NULL_TARGETS.has(r.path) || r.path.startsWith('/dev/fd/')) return;
    out.push({ path: r.path, op, detail, unresolved: r.unresolved });
  };
  for (const r of v.cmd.redirects) {
    const op = r.op.replace(/^\d+/, '');
    const fdTarget = /^(?:\d+|-)$/.test(r.target.value);
    if (WRITE_REDIRECTS.has(op) || (op === '>&' && !fdTarget))
      emit(r.target, 'write', `redirect ${op}`);
    else if (op === '<') emit(r.target, 'read', 'redirect <');
  }
  const handler =
    HANDLERS.get(v.program) ??
    (PYTHON_RE.test(v.program) ? interpreter(['-c', '-m'], 'WXQ') : undefined);
  handler?.(v, emit, home);
  if (v.programWord?.value.includes('/') === true) {
    const r = resolveWord(v.programWord, v.cwd, home);
    if (r && !SYSTEM_BIN.some((dir) => r.path.startsWith(dir))) {
      out.push({ path: r.path, op: 'exec', detail: 'exec', unresolved: r.unresolved });
    }
  }
  return out;
}

// Handler builders -------------------------------------------------------------

/** Every operand is accessed with `op`. */
function allOperands(op: FileOp, spec: OptSpec = {}, detail?: string): Handler {
  return (v, emit) => {
    for (const w of operandsOf(parseArgs(v.args, spec))) emit(w, op, detail ?? v.program);
  };
}

/** The first operand is a pattern or program unless one of `patternOpts` gave it. */
function patternThenFiles(
  spec: OptSpec,
  patternOpts: string[],
  fileOpts: string[],
  op: FileOp = 'read',
): Handler {
  return (v, emit) => {
    const items = parseArgs(v.args, spec);
    for (const w of optValues(items, ...fileOpts)) emit(w, 'read', v.program);
    const ops = operandsOf(items);
    const skip = hasOpt(items, ...patternOpts) ? 0 : 1;
    for (const w of ops.slice(skip)) {
      if (v.program.endsWith('awk') && /^[A-Za-z_]\w*=/.test(w.value)) continue;
      emit(w, op, v.program);
    }
  };
}

/** cp, mv, install, scp: sources then a destination (or -t DIR). */
function copyLike(sourceOp: FileOp, spec: OptSpec): Handler {
  return (v, emit) => {
    const items = parseArgs(v.args, spec);
    if (v.program === 'install' && hasOpt(items, '-d', '--directory')) {
      for (const w of operandsOf(items)) emit(w, 'write', 'install -d');
      return;
    }
    const remote = (w: Word): boolean => v.program === 'scp' && isRemote(w.value);
    const ops = operandsOf(items);
    const target = optValue(items, '-t', '--target-directory');
    const dest = target ?? (ops.length >= 2 ? (ops.at(-1) ?? null) : null);
    if (dest === null) return;
    const sources = target ? ops : ops.slice(0, -1);
    for (const w of sources) if (!remote(w)) emit(w, sourceOp, `${v.program} source`);
    if (!remote(dest)) emit(dest, 'write', `${v.program} destination`);
  };
}

function isRemote(value: string): boolean {
  return /^(?:[^@/:]+@)?[^/:]+:/.test(value) && !value.startsWith('/') && !value.startsWith('.');
}

/** Interpreters: the first operand is a script unless a code option came first. */
function interpreter(codeOpts: string[], short = '', long: string[] = []): Handler {
  return (v, emit) => {
    for (const item of parseArgs(v.args, {
      short: short + codeOpts.map((o) => o.slice(1)).join(''),
      long,
    })) {
      if (item.kind === 'opt') {
        if (codeOpts.includes(item.name) || ['--eval', '--print'].includes(item.name)) return;
        if (item.name === '--env-file') emit(item.value, 'read', `${v.program} --env-file`);
        continue;
      }
      if (item.word.value !== '-') emit(item.word, 'exec', `${v.program} script`);
      return;
    }
  };
}

function urlBasename(url: string): string | null {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)?/i.exec(url);
  if (!m) return null;
  const path = m[1] ?? '';
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name === '' ? 'index.html' : name;
}

// Program handlers -------------------------------------------------------------

const GREP_SPEC: OptSpec = {
  short: 'efmABCdD',
  long: [
    '--regexp',
    '--file',
    '--max-count',
    '--after-context',
    '--before-context',
    '--context',
    '--include',
    '--exclude',
    '--exclude-dir',
    '--label',
    '--directories',
    '--devices',
    '--binary-files',
  ],
};
const RG_SPEC: OptSpec = {
  short: 'efgtTmABCjMrE',
  long: [
    '--regexp',
    '--file',
    '--glob',
    '--iglob',
    '--type',
    '--type-not',
    '--max-count',
    '--after-context',
    '--before-context',
    '--context',
    '--threads',
    '--max-columns',
    '--replace',
    '--encoding',
    '--ignore-file',
    '--type-add',
    '--sort',
    '--sortr',
    '--max-depth',
    '--max-filesize',
    '--pre',
    '--pre-glob',
    '--colors',
    '--context-separator',
    '--path-separator',
    '--engine',
  ],
};
const CURL_SPEC: OptSpec = {
  short: 'AbcCdDeEFHKmoPQrtTuUwxXyYz',
  long: [
    '--output',
    '--upload-file',
    '--data',
    '--data-binary',
    '--data-raw',
    '--data-urlencode',
    '--data-ascii',
    '--json',
    '--form',
    '--form-string',
    '--config',
    '--cookie',
    '--cookie-jar',
    '--dump-header',
    '--user',
    '--header',
    '--request',
    '--user-agent',
    '--referer',
    '--proxy',
    '--max-time',
    '--connect-timeout',
    '--retry',
    '--output-dir',
    '--cert',
    '--key',
    '--cacert',
    '--capath',
    '--range',
    '--write-out',
    '--resolve',
    '--connect-to',
    '--url',
    '--limit-rate',
    '--max-filesize',
    '--interface',
    '--proxy-user',
    '--oauth2-bearer',
    '--unix-socket',
    '--variable',
  ],
};
const WGET_SPEC: OptSpec = {
  short: 'OPoaiUeTtwlQ',
  long: [
    '--output-document',
    '--directory-prefix',
    '--output-file',
    '--append-output',
    '--input-file',
    '--user-agent',
    '--execute',
    '--timeout',
    '--tries',
    '--wait',
    '--level',
    '--quota',
    '--header',
    '--user',
    '--password',
  ],
};
const CP_SPEC: OptSpec = { short: 'tS', long: ['--target-directory', '--suffix'] };
const CHMOD_FLAGS = /^-[RfvchHLPN]+$/;
const CHMOD_LONG = new Set([
  '--recursive',
  '--verbose',
  '--changes',
  '--silent',
  '--quiet',
  '--no-dereference',
  '--dereference',
  '--preserve-root',
  '--no-preserve-root',
]);

function chmodLike(op: FileOp): Handler {
  return (v, emit) => {
    let modeSeen = false;
    let operandsOnly = false;
    for (const w of v.args) {
      const val = w.value;
      if (!operandsOnly) {
        if (val === '--') {
          operandsOnly = true;
          continue;
        }
        if (CHMOD_FLAGS.test(val) || CHMOD_LONG.has(val) || val.startsWith('--from=')) continue;
        if (val.startsWith('--reference=')) {
          modeSeen = true;
          continue;
        }
      }
      if (!modeSeen) {
        modeSeen = true;
        continue;
      }
      emit(w, op, v.program);
    }
  };
}

const sedHandler: Handler = (v, emit) => {
  let inPlace = false;
  let scriptGiven = false;
  const ops: Word[] = [];
  const a = v.args;
  let operandsOnly = false;
  for (let i = 0; i < a.length; i++) {
    const w = a[i];
    if (!w) continue;
    const val = w.value;
    if (operandsOnly || !val.startsWith('-') || val === '-') {
      ops.push(w);
      continue;
    }
    if (val === '--') {
      operandsOnly = true;
    } else if (val.startsWith('--')) {
      if (val.startsWith('--in-place')) inPlace = true;
      if (val.startsWith('--expression') || val.startsWith('--file')) {
        scriptGiven = true;
        if (val.startsWith('--file'))
          emit(
            val.includes('=') ? deriveWord(w, val.slice(val.indexOf('=') + 1)) : a[i + 1],
            'read',
            'sed -f',
          );
        if (!val.includes('=')) i++;
      }
    } else {
      for (let k = 1; k < val.length; k++) {
        const ch = val.charAt(k);
        const rest = val.slice(k + 1);
        if (ch === 'i' || ch === 'I') {
          inPlace = true;
          const next = a[i + 1];
          if (rest === '' && next && (next.value === '' || /^\.[\w~.-]{0,15}$/.test(next.value)))
            i++;
          break;
        }
        if (ch === 'e' || ch === 'f' || ch === 'l') {
          if (ch !== 'l') scriptGiven = true;
          const valueWord = rest !== '' ? deriveWord(w, rest) : a[i + 1];
          if (ch === 'f') emit(valueWord, 'read', 'sed -f');
          if (rest === '') i++;
          break;
        }
      }
    }
  }
  for (const w of ops.slice(scriptGiven ? 0 : 1)) {
    emit(w, inPlace ? 'write' : 'read', inPlace ? 'sed -i' : 'sed');
  }
};

const perlHandler: Handler = (v, emit) => {
  let inPlace = false;
  let code = false;
  const ops: Word[] = [];
  const a = v.args;
  let operandsOnly = false;
  for (let i = 0; i < a.length; i++) {
    const w = a[i];
    if (!w) continue;
    const val = w.value;
    if (operandsOnly || !val.startsWith('-') || val === '-') {
      ops.push(w);
      operandsOnly = true;
      continue;
    }
    if (val === '--') {
      operandsOnly = true;
      continue;
    }
    for (let k = 1; k < val.length; k++) {
      const ch = val.charAt(k);
      if (ch === 'i') {
        inPlace = true;
        break;
      }
      if (ch === 'e' || ch === 'E') {
        code = true;
        if (k === val.length - 1) i++;
        break;
      }
      if ('MmIFxCdD0l'.includes(ch)) {
        if (k === val.length - 1 && 'MmI'.includes(ch)) i++;
        break;
      }
    }
  }
  let files = ops;
  if (!code) {
    emit(ops[0], 'exec', 'perl script');
    files = ops.slice(1);
    if (!inPlace) return;
  }
  for (const w of files) emit(w, inPlace ? 'write' : 'read', inPlace ? 'perl -i' : 'perl');
};

const curlHandler: Handler = (v, emit, home) => {
  const items = parseArgs(v.args, CURL_SPEC);
  for (const w of optValues(items, '-o', '--output')) emit(w, 'write', 'curl -o');
  for (const w of optValues(items, '-T', '--upload-file')) emit(w, 'read', 'curl upload');
  for (const w of optValues(items, '-K', '--config')) emit(w, 'read', 'curl config');
  for (const w of optValues(items, '-c', '--cookie-jar', '-D', '--dump-header'))
    emit(w, 'write', 'curl');
  for (const w of optValues(
    items,
    '-d',
    '--data',
    '--data-binary',
    '--data-ascii',
    '--data-urlencode',
    '--json',
  )) {
    const at = w.value.indexOf('@');
    if (
      at !== -1 &&
      (at === 0 || (v.program === 'curl' && /^[\w.-]*$/.test(w.value.slice(0, at))))
    ) {
      emit(deriveWord(w, w.value.slice(at + 1)), 'read', 'curl data');
    }
  }
  for (const w of optValues(items, '-F', '--form')) {
    const m = /=[@<]([^;]*)/.exec(w.value);
    if (m?.[1] !== undefined) emit(deriveWord(w, m[1]), 'read', 'curl form');
  }
  if (hasOpt(items, '-O', '--remote-name', '--remote-name-all')) {
    const dir = optValue(items, '--output-dir');
    const base = dir ? resolveWord(dir, v.cwd, home) : null;
    const urls = [...operandsOf(items), ...optValues(items, '--url')];
    for (const w of urls) {
      const name = urlBasename(w.value);
      if (name !== null) emit(literalWord(name), 'write', 'curl -O', base?.path ?? v.cwd);
    }
  }
};

const wgetHandler: Handler = (v, emit, home) => {
  const items = parseArgs(v.args, WGET_SPEC);
  for (const w of optValues(items, '-o', '--output-file', '-a', '--append-output'))
    emit(w, 'write', 'wget log');
  for (const w of optValues(items, '-i', '--input-file')) emit(w, 'read', 'wget input');
  const output = optValue(items, '-O', '--output-document');
  if (output) {
    emit(output, 'write', 'wget -O');
    return;
  }
  const prefix = optValue(items, '-P', '--directory-prefix');
  const dir = prefix ? resolveWord(prefix, v.cwd, home) : null;
  for (const w of operandsOf(items)) {
    const name = urlBasename(w.value);
    if (name !== null) emit(literalWord(name), 'write', 'wget download', dir?.path ?? v.cwd);
  }
};

const gitHandler: Handler = (v, emit, home) => {
  const git = gitParts(v, home);
  if (git.sub === 'clone') {
    const items = parseArgs(git.args, {
      short: 'bcjou',
      long: [
        '--branch',
        '--config',
        '--depth',
        '--origin',
        '--upload-pack',
        '--template',
        '--reference',
        '--reference-if-able',
        '--separate-git-dir',
        '--filter',
        '--jobs',
        '--shallow-since',
        '--shallow-exclude',
        '--server-option',
        '--bundle-uri',
      ],
    });
    const [repo, dir] = operandsOf(items);
    if (dir) emit(dir, 'write', 'git clone target', git.cwd);
    else if (repo) {
      const name =
        repo.value
          .replace(/\/+$/, '')
          .split(/[/:]/)
          .at(-1)
          ?.replace(/\.git$/, '') ?? '';
      if (name !== '') emit(literalWord(name), 'write', 'git clone target', git.cwd);
    }
  } else if (git.sub === 'rm') {
    const items = parseArgs(git.args, { long: ['--pathspec-from-file'] });
    if (hasOpt(items, '--cached', '-n', '--dry-run')) return;
    for (const w of operandsOf(items)) emit(w, 'delete', 'git rm', git.cwd);
  } else if (git.sub === 'mv') {
    const ops = operandsOf(parseArgs(git.args));
    if (ops.length < 2) return;
    for (const w of ops.slice(0, -1)) emit(w, 'delete', 'git mv source', git.cwd);
    emit(ops.at(-1), 'write', 'git mv destination', git.cwd);
  }
};

const findHandler: Handler = (v, emit) => {
  const a = v.args;
  let i = 0;
  while (i < a.length && /^-[HLP]$|^-O\d*$/.test(a[i]?.value ?? '')) i++;
  const roots: Word[] = [];
  while (i < a.length) {
    const val = a[i]?.value ?? '';
    if (val.startsWith('-') || val === '(' || val === '!' || val === ')') break;
    const w = a[i];
    if (w) roots.push(w);
    i++;
  }
  const deletes = a.slice(i).some((w) => w.value === '-delete');
  if (roots.length === 0 && deletes) roots.push(literalWord('.'));
  for (const w of roots) emit(w, deletes ? 'delete' : 'list', deletes ? 'find -delete' : 'find');
};

const lnHandler: Handler = (v, emit) => {
  const items = parseArgs(v.args, CP_SPEC);
  const ops = operandsOf(items);
  const target = optValue(items, '-t', '--target-directory');
  if (target) {
    for (const w of ops)
      emit(deriveWord(target, joinPath(target.value, baseName(w.value))), 'write', 'ln');
  } else if (ops.length >= 2) {
    emit(ops.at(-1), 'write', 'ln');
  } else if (ops[0]) {
    emit(deriveWord(ops[0], baseName(ops[0].value)), 'write', 'ln');
  }
};

const ddHandler: Handler = (v, emit) => {
  for (const w of v.args) {
    if (w.value.startsWith('if=')) emit(deriveWord(w, w.value.slice(3)), 'read', 'dd if=');
    if (w.value.startsWith('of=')) emit(deriveWord(w, w.value.slice(3)), 'write', 'dd of=');
  }
};

const openSslHandler: Handler = (v, emit) => {
  const a = v.args;
  for (let i = 0; i < a.length; i++) {
    const val = a[i]?.value ?? '';
    if (['-in', '-inkey', '-key', '-kfile', '-signkey'].includes(val))
      emit(a[i + 1], 'read', `openssl ${val}`);
    if (['-out', '-keyout'].includes(val)) emit(a[i + 1], 'write', `openssl ${val}`);
  }
};

/** First operand read, second written (xxd, uniq). */
function inOut(spec: OptSpec): Handler {
  return (v, emit) => {
    const [input, output] = operandsOf(parseArgs(v.args, spec));
    emit(input, 'read', v.program);
    emit(output, 'write', v.program);
  };
}

const jqHandler: Handler = (v, emit) => {
  const a = v.args;
  const ops: Word[] = [];
  let fromFile = false;
  for (let i = 0; i < a.length; i++) {
    const val = a[i]?.value ?? '';
    if (val === '--args' || val === '--jsonargs') break;
    if (val === '--arg' || val === '--argjson') i += 2;
    else if (val === '--slurpfile' || val === '--rawfile') {
      emit(a[i + 2], 'read', v.program);
      i += 2;
    } else if (val === '-f' || val === '--from-file') {
      fromFile = true;
      emit(a[i + 1], 'read', v.program);
      i++;
    } else if (val === '-L' || val === '--indent') i++;
    else if (!val.startsWith('-') || val === '-') {
      const w = a[i];
      if (w) ops.push(w);
    }
  }
  for (const w of ops.slice(fromFile ? 0 : 1)) emit(w, 'read', v.program);
};

const yqHandler: Handler = (v, emit) => {
  const items = parseArgs(v.args, {
    short: 'opI',
    long: ['--output-format', '--input-format', '--indent', '--expression', '--front-matter'],
  });
  let ops = operandsOf(items);
  if (['eval', 'e', 'eval-all', 'ea'].includes(ops[0]?.value ?? '')) ops = ops.slice(1);
  const inPlace = hasOpt(items, '-i', '--inplace');
  for (const w of ops.slice(1)) emit(w, inPlace ? 'write' : 'read', inPlace ? 'yq -i' : 'yq');
};

const bunDenoHandler: Handler = (v, emit) => {
  const ops = operandsOf(parseArgs(v.args));
  let script = ops[0];
  if (script?.value === 'run') script = ops[1];
  if (script && /\.(?:[cm]?[jt]sx?)$/.test(script.value))
    emit(script, 'exec', `${v.program} script`);
};

const sortHandler: Handler = (v, emit) => {
  const items = parseArgs(v.args, {
    short: 'kotTSy',
    long: [
      '--key',
      '--output',
      '--field-separator',
      '--temporary-directory',
      '--buffer-size',
      '--files0-from',
    ],
  });
  for (const w of optValues(items, '-o', '--output')) emit(w, 'write', 'sort -o');
  for (const w of operandsOf(items)) emit(w, 'read', 'sort');
};

const base64Handler: Handler = (v, emit) => {
  const items = parseArgs(v.args, {
    short: 'iobw',
    long: ['--input', '--output', '--wrap', '--break'],
  });
  for (const w of optValues(items, '-i', '--input')) emit(w, 'read', 'base64');
  for (const w of optValues(items, '-o', '--output')) emit(w, 'write', 'base64 -o');
  for (const w of operandsOf(items)) emit(w, 'read', 'base64');
};

const sourceHandler: Handler = (v, emit) => {
  emit(v.args[0], 'read', 'source');
};

const SHELL_SCRIPT = interpreter(['-c'], 'oO', ['--rcfile', '--init-file']);
const shellScript: Handler = (v, emit, home) => {
  if (v.args.some((w) => /^-[a-zA-Z]*s[a-zA-Z]*$/.test(w.value))) return;
  SHELL_SCRIPT(v, emit, home);
};

const HANDLERS = new Map<string, Handler>([
  ...['cat', 'less', 'more', 'bat', 'tac', 'wc', 'cmp', 'comm', 'md5', 'cksum'].map(
    (p): [string, Handler] => [p, allOperands('read')],
  ),
  ['head', allOperands('read', { short: 'nc', long: ['--lines', '--bytes'] })],
  [
    'tail',
    allOperands('read', {
      short: 'ncs',
      long: ['--lines', '--bytes', '--pid', '--sleep-interval'],
    }),
  ],
  ['nl', allOperands('read', { short: 'bdfhilnsvw' })],
  ['strings', allOperands('read', { short: 'nte' })],
  ['od', allOperands('read', { short: 'AjNt' })],
  ['hexdump', allOperands('read', { short: 'enfs' })],
  [
    'cut',
    allOperands('read', {
      short: 'dfcb',
      long: ['--delimiter', '--fields', '--characters', '--bytes'],
    }),
  ],
  ['paste', allOperands('read', { short: 'd' })],
  [
    'diff',
    allOperands('read', {
      short: 'xXIFLDCU',
      long: [
        '--exclude',
        '--exclude-from',
        '--ignore-matching-lines',
        '--label',
        '--unified',
        '--context',
        '--to-file',
        '--from-file',
      ],
    }),
  ],
  ...['md5sum', 'sha1sum', 'sha256sum', 'sha512sum', 'shasum'].map((p): [string, Handler] => [
    p,
    allOperands('read', { short: 'a' }),
  ]),
  ...['grep', 'egrep', 'fgrep', 'zgrep'].map((p): [string, Handler] => [
    p,
    patternThenFiles(GREP_SPEC, ['-e', '--regexp', '-f', '--file'], ['-f', '--file']),
  ]),
  [
    'rg',
    (v, emit, home) => {
      if (v.args.some((w) => w.value === '--files')) allOperands('list', RG_SPEC)(v, emit, home);
      else
        patternThenFiles(RG_SPEC, ['-e', '--regexp', '-f', '--file'], ['-f', '--file'])(
          v,
          emit,
          home,
        );
    },
  ],
  [
    'ag',
    patternThenFiles({ short: 'ABCGgmp', long: ['--ignore', '--file-search-regex'] }, ['-g'], []),
  ],
  ...['awk', 'gawk', 'mawk', 'nawk'].map((p): [string, Handler] => [
    p,
    patternThenFiles({ short: 'fvF' }, ['-f'], ['-f']),
  ]),
  ['sed', sedHandler],
  ['gsed', sedHandler],
  ['perl', perlHandler],
  ['jq', jqHandler],
  ['yq', yqHandler],
  ['openssl', openSslHandler],
  ['source', sourceHandler],
  ['.', sourceHandler],
  ['xxd', inOut({ short: 'cglos' })],
  ['uniq', inOut({ short: 'fs' })],
  ['sort', sortHandler],
  ['base64', base64Handler],
  ['cp', copyLike('read', CP_SPEC)],
  ['scp', copyLike('read', { short: 'cFiJlLoPSDX' })],
  ['mv', copyLike('delete', CP_SPEC)],
  [
    'install',
    copyLike('read', {
      short: 'BfgmoSt',
      long: ['--mode', '--owner', '--group', '--target-directory', '--suffix'],
    }),
  ],
  ['tee', allOperands('write', {}, 'tee')],
  ['touch', allOperands('write', { short: 'trdA' }, 'touch')],
  ['mkdir', allOperands('write', { short: 'm', long: ['--mode'] }, 'mkdir')],
  ['truncate', allOperands('write', { short: 'sr', long: ['--size', '--reference'] }, 'truncate')],
  ['ln', lnHandler],
  ['dd', ddHandler],
  ['curl', curlHandler],
  ['wget', wgetHandler],
  ['git', gitHandler],
  ['rm', allOperands('delete', {}, 'rm')],
  ['rmdir', allOperands('delete', {}, 'rmdir')],
  ['unlink', allOperands('delete', {}, 'unlink')],
  ['shred', allOperands('delete', { short: 'nsu' }, 'shred')],
  ['chmod', chmodLike('chmod')],
  ['chown', chmodLike('chmod')],
  ['chgrp', chmodLike('chmod')],
  ['find', findHandler],
  ['ls', allOperands('list', { short: 'Iw', long: ['--ignore', '--width'] }, 'ls')],
  ['tree', allOperands('list', { short: 'LPIo' }, 'tree')],
  ['du', allOperands('list', { short: 'dB', long: ['--max-depth'] }, 'du')],
  ...[...SHELL_INTERPRETERS].map((p): [string, Handler] => [p, shellScript]),
  [
    'node',
    interpreter(['-e', '-p'], 'rC', [
      '--require',
      '--import',
      '--loader',
      '--experimental-loader',
      '--conditions',
      '--input-type',
    ]),
  ],
  ['ruby', interpreter(['-e'], 'IrCEFx')],
  ['php', interpreter(['-r'], 'cdfBERzt')],
  ['tsx', interpreter([])],
  ['ts-node', interpreter(['-e', '-p'])],
  ['bun', bunDenoHandler],
  ['deno', bunDenoHandler],
]);

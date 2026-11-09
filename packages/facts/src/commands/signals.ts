/**
 * Signals implied by parsed shell commands: network access, network content
 * run by a shell, skipped safety checks, privilege, scheduled tasks,
 * persistence through configuration, credential printing, destructive
 * commands, and touching Stillwatch itself. Facts only: rules decide what
 * they mean.
 */
import type { SignalList } from '../injection';
import { hasOpt, operandsOf, optValue, parseArgs, type ArgItem } from '../shell/args';
import { resolveWord } from '../shell/resolve';
import type { Word } from '../shell/types';
import { capText } from '../text';
import { FETCHERS, gitParts, isInterpreter, SHELL_INTERPRETERS, type CommandView } from './view';

export type SignalContext = { home: string };

type Emit = SignalList['add'];

/** Programs that always talk to another host. */
const NETWORK_PROGRAMS = new Set([
  ...FETCHERS,
  'ssh',
  'scp',
  'sftp',
  'ftp',
  'telnet',
  'nc',
  'ncat',
  'netcat',
  'socat',
  'aria2c',
]);
const GIT_NETWORK = new Set(['clone', 'fetch', 'pull', 'push', 'ls-remote']);
const GIT_VERIFY_SKIPPABLE = new Set([
  'commit',
  'push',
  'merge',
  'rebase',
  'am',
  'cherry-pick',
  'revert',
]);
const CONTAINER_NETWORK = new Set(['pull', 'push', 'login']);

/** Environment assignments that switch off a check, with the value pattern that does it. */
const BYPASS_ENV: readonly { name: string; when: RegExp; detail: string }[] = [
  { name: 'NODE_TLS_REJECT_UNAUTHORIZED', when: /^0$/, detail: 'NODE_TLS_REJECT_UNAUTHORIZED=0' },
  { name: 'GIT_SSL_NO_VERIFY', when: /^(?!0$|false$).+/i, detail: 'GIT_SSL_NO_VERIFY' },
  { name: 'PYTHONHTTPSVERIFY', when: /^0$/, detail: 'PYTHONHTTPSVERIFY=0' },
  { name: 'HUSKY', when: /^0$/, detail: 'HUSKY=0' },
  { name: 'HUSKY_SKIP_HOOKS', when: /^(?!0$|false$).+/i, detail: 'HUSKY_SKIP_HOOKS' },
  { name: 'LEFTHOOK', when: /^(0|false)$/i, detail: 'LEFTHOOK=0' },
  { name: 'SKIP', when: /.+/, detail: 'SKIP (pre-commit)' },
];

/** git config keys whose value runs a program or redirects where git talks to. */
const GIT_PERSIST_KEY =
  /^(core\.(hookspath|fsmonitor|sshcommand|pager|editor|askpass)|sequence\.editor|credential\.helper|include\.path|includeif\..+\.path|alias\..+|filter\..+\.(clean|smudge|process)|diff\..+\.(textconv|command)|merge\..+\.driver|url\..+\.insteadof|gpg\.program|gpg\..+\.program)$/;

const CREDENTIAL_ENV_NAME =
  /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS?)/i;

const BROAD_DELETE_NAMES = new Set([
  '/',
  '*',
  '.',
  '..',
  '/*',
  '~',
  '~/',
  '~/*',
  '$HOME',
  '${HOME}',
  '$HOME/*',
  '.git',
]);
const TOP_LEVEL_DIRS = new Set([
  '/Users',
  '/home',
  '/root',
  '/etc',
  '/usr',
  '/var',
  '/opt',
  '/bin',
  '/sbin',
  '/lib',
  '/System',
  '/Library',
  '/Applications',
  '/private',
]);

/** Emits command signals for every parsed command of one command line. */
export function commandSignals(
  views: readonly CommandView[],
  emit: Emit,
  context: SignalContext,
): void {
  for (const v of views) {
    if (v.program === '') {
      envBypass(v.assignments, emit);
      continue;
    }
    envBypass(v.assignments, emit);
    if (v.sudo) emit('privilege', v.wrappers.includes('doas') ? 'doas' : 'sudo', 'high');
    const fetcher = pipedFetcher(views, v);
    if (fetcher !== null) emit('pipe_to_shell', `${fetcher} | ${v.program}`, 'high');
    network(v, emit);
    PROGRAM_SIGNALS.get(v.program)?.(v, emit, context);
    if (v.program.startsWith('docker-credential-') && v.values.includes('get')) {
      emit('credential_command', `${v.program} get`, 'high');
    }
    if (v.program === 'export' || v.program === 'declare' || v.program === 'typeset') {
      envBypass(
        v.values.filter((a) => a.includes('=')),
        emit,
      );
    }
    tampering(v, emit);
  }
}

/** True when this command runs network content: the shell end of `curl | sh`, `bash <(curl)`, `eval "$(curl)"`. */
export function isPipedToShell(views: readonly CommandView[], v: CommandView): boolean {
  return pipedFetcher(views, v) !== null;
}

function pipedFetcher(views: readonly CommandView[], v: CommandView): string | null {
  const runsCode =
    isInterpreter(v.program) || v.program === 'eval' || v.program === 'source' || v.program === '.';
  if (!runsCode) return null;
  const words: Word[] = [...v.args, ...v.cmd.redirects.map((r) => r.target)];
  for (const w of words) {
    for (const s of w.subst) {
      const p = views[s]?.program;
      if (p !== undefined && FETCHERS.has(p)) return p;
    }
  }
  if (!readsStdin(v)) return null;
  let j = v.cmd.pipedFrom;
  for (let hops = 0; j !== null && hops < views.length; hops++) {
    const up = views[j];
    if (up === undefined) break;
    if (FETCHERS.has(up.program)) return up.program;
    j = up.cmd.pipedFrom;
  }
  return null;
}

/** An interpreter reads its program from stdin when given no script operand, `-`, or `-s`. */
function readsStdin(v: CommandView): boolean {
  if (v.program === 'eval' || v.program === 'source' || v.program === '.') return false;
  if (v.values.includes('-c') || v.values.includes('-e')) return false;
  const first = v.values.find((a) => !a.startsWith('-') || a === '-');
  return (
    first === undefined ||
    first === '-' ||
    (SHELL_INTERPRETERS.has(v.program) && v.values.includes('-s'))
  );
}

function network(v: CommandView, emit: Emit): void {
  const p = v.program;
  if (NETWORK_PROGRAMS.has(p)) {
    emit('network', p, 'high');
    return;
  }
  if (p === 'rsync' && v.values.some((a) => a.startsWith('rsync://') || /^[^/]*[^/\\]:/.test(a))) {
    emit('network', 'rsync', 'high');
  } else if (p === 'git') {
    const sub = gitParts(v, '').sub;
    if (GIT_NETWORK.has(sub)) emit('network', `git ${sub}`, 'high');
    else if (sub === 'submodule' && v.values.includes('update'))
      emit('network', 'git submodule update', 'medium');
  } else if (p === 'gh') {
    emit('network', 'gh', 'high');
  } else if (p === 'docker' || p === 'podman') {
    const sub = operandsOf(parseArgs(v.args)).at(0)?.value ?? '';
    if (CONTAINER_NETWORK.has(sub)) emit('network', `${p} ${sub}`, 'high');
  }
}

function envBypass(assignments: readonly string[], emit: Emit): void {
  for (const a of assignments) {
    const eq = a.indexOf('=');
    if (eq <= 0) continue;
    const name = a.slice(0, eq);
    const value = a.slice(eq + 1).replace(/^["']|["']$/g, '');
    const spec = BYPASS_ENV.find((b) => b.name === name);
    if (spec?.when.test(value) === true) emit('safety_bypass', spec.detail, 'high');
  }
}

type Handler = (v: CommandView, emit: Emit, context: SignalContext) => void;

const PROGRAM_SIGNALS = new Map<string, Handler>([
  ['git', git],
  [
    'curl',
    (v, emit) => {
      if (hasOpt(parseArgs(v.args, { short: 'oOdHXuAeEw' }), '-k', '--insecure')) {
        emit('safety_bypass', 'curl --insecure', 'high');
      }
    },
  ],
  [
    'wget',
    (v, emit) => {
      if (v.values.includes('--no-check-certificate'))
        emit('safety_bypass', 'wget --no-check-certificate', 'high');
    },
  ],
  [
    'ssh',
    (v, emit) => {
      if (v.values.some((a) => /StrictHostKeyChecking=no/i.test(a))) {
        emit('safety_bypass', 'StrictHostKeyChecking=no', 'medium');
      }
    },
  ],
  ['pip', pipBypass],
  ['pip3', pipBypass],
  ['uv', pipBypass],
  ['npm', npmConfig],
  ['pnpm', npmConfig],
  ['yarn', npmConfig],
  [
    'claude',
    (v, emit) => {
      if (v.values.includes('--dangerously-skip-permissions')) {
        emit('safety_bypass', 'claude --dangerously-skip-permissions', 'high');
      }
      const mode = optValue(
        parseArgs(v.args, { long: ['--permission-mode'] }),
        '--permission-mode',
      );
      if (mode?.value === 'bypassPermissions')
        emit('safety_bypass', 'claude --permission-mode bypassPermissions', 'high');
    },
  ],
  [
    'codex',
    (v, emit) => {
      if (
        v.values.includes('--dangerously-bypass-approvals-and-sandbox') ||
        v.values.includes('--yolo')
      ) {
        emit('safety_bypass', 'codex sandbox bypass', 'high');
      }
    },
  ],
  ['chmod', chmod],
  ['chown', chownRoot],
  ['chgrp', chownRoot],
  ['setcap', (_v, emit) => emit('privilege', 'setcap', 'high')],
  [
    'crontab',
    (v, emit) => {
      const items = parseArgs(v.args, { short: 'u' });
      if (hasOpt(items, '-l') && !hasOpt(items, '-r', '-e')) return;
      emit('scheduled_task', hasOpt(items, '-r') ? 'crontab -r' : 'crontab', 'high');
    },
  ],
  [
    'launchctl',
    (v, emit) => {
      const sub = operandsOf(parseArgs(v.args)).at(0)?.value ?? '';
      if (['load', 'bootstrap', 'enable', 'submit'].includes(sub))
        emit('scheduled_task', `launchctl ${sub}`, 'high');
    },
  ],
  [
    'systemctl',
    (v, emit) => {
      const sub =
        operandsOf(
          parseArgs(v.args, {
            short: 'HMpt',
            long: ['--host', '--machine', '--property', '--type'],
          }),
        ).at(0)?.value ?? '';
      if (sub === 'enable' || sub === 'link' || sub === 'reenable')
        emit('scheduled_task', `systemctl ${sub}`, 'high');
    },
  ],
  [
    'at',
    (v, emit) => {
      if (!v.values.some((a) => a === '-l' || a === '-r' || a === '-d'))
        emit('scheduled_task', 'at', 'high');
    },
  ],
  ['batch', (_v, emit) => emit('scheduled_task', 'batch', 'medium')],
  [
    'defaults',
    (v, emit) => {
      if (
        v.values[0] === 'write' &&
        v.values.some((a) => /loginwindow|LoginHook|LogoutHook/i.test(a))
      ) {
        emit('persistence_command', 'defaults write loginwindow', 'high');
      }
    },
  ],
  [
    'osascript',
    (v, emit) => {
      if (v.values.some((a) => /login item/i.test(a)))
        emit('persistence_command', 'login item (osascript)', 'high');
    },
  ],
  [
    'security',
    (v, emit) => {
      const sub = v.values[0] ?? '';
      if (/^find-(generic|internet)-password$/.test(sub)) {
        emit(
          'credential_command',
          `security ${sub}`,
          v.values.includes('-w') || v.values.includes('-g') ? 'high' : 'medium',
        );
      } else if (sub === 'dump-keychain' || sub === 'export') {
        emit('credential_command', `security ${sub}`, 'high');
      }
    },
  ],
  [
    'gh',
    (v, emit) => {
      if (
        v.values[0] === 'auth' &&
        (v.values[1] === 'token' || v.values.includes('--show-token'))
      ) {
        emit('credential_command', 'gh auth token', 'high');
      }
    },
  ],
  [
    'printenv',
    (v, emit) => {
      const names = operandsOf(parseArgs(v.args)).map((w) => w.value);
      if (names.length === 0) emit('credential_command', 'printenv', 'medium');
      else if (names.some((n) => CREDENTIAL_ENV_NAME.test(n)))
        emit('credential_command', 'printenv', 'high');
    },
  ],
  [
    'env',
    (v, emit) => {
      if (operandsOf(parseArgs(v.args, { short: 'uCS' })).length === 0)
        emit('credential_command', 'env', 'medium');
    },
  ],
  ['echo', echoSecret],
  ['printf', echoSecret],
  [
    'aws',
    (v, emit) => {
      const [a, b] = operandsOf(
        parseArgs(v.args, { long: ['--profile', '--region', '--output', '--query'] }),
      ).map((w) => w.value);
      const pair = `${a ?? ''} ${b ?? ''}`;
      if (
        [
          'configure get',
          'configure export-credentials',
          'sts get-session-token',
          'ecr get-login-password',
          'secretsmanager get-secret-value',
        ].includes(pair) ||
        (a === 'ssm' &&
          (b === 'get-parameter' || b === 'get-parameters') &&
          v.values.includes('--with-decryption'))
      ) {
        emit('credential_command', `aws ${pair}`, 'high');
      }
    },
  ],
  [
    'gcloud',
    (v, emit) => {
      if (v.values.some((a) => /^print-(access|identity)-token$/.test(a)))
        emit('credential_command', 'gcloud auth print-access-token', 'high');
    },
  ],
  [
    'az',
    (v, emit) => {
      if (v.values[0] === 'account' && v.values[1] === 'get-access-token')
        emit('credential_command', 'az account get-access-token', 'high');
    },
  ],
  [
    'op',
    (v, emit) => {
      if (
        v.values[0] === 'read' ||
        v.values[0] === 'inject' ||
        (v.values[0] === 'item' && v.values[1] === 'get')
      ) {
        emit('credential_command', `op ${v.values[0]}`, 'high');
      }
    },
  ],
  [
    'pass',
    (v, emit) => {
      if (v.values[0] === 'show') emit('credential_command', 'pass show', 'high');
    },
  ],
  [
    'vault',
    (v, emit) => {
      if (v.values[0] === 'read' || (v.values[0] === 'kv' && v.values[1] === 'get'))
        emit('credential_command', `vault ${v.values[0]}`, 'high');
    },
  ],
  [
    'kubectl',
    (v, emit) => {
      const ops = operandsOf(
        parseArgs(v.args, { short: 'no', long: ['--namespace', '--output', '--context'] }),
      ).map((w) => w.value);
      if (
        (ops[0] === 'get' || ops[0] === 'describe') &&
        (ops[1] === 'secret' || ops[1] === 'secrets' || ops[1]?.startsWith('secret/') === true)
      ) {
        emit('credential_command', `kubectl ${ops[0]} secret`, 'high');
      }
    },
  ],
  [
    'heroku',
    (v, emit) => {
      if (v.values[0] === 'auth:token') emit('credential_command', 'heroku auth:token', 'high');
    },
  ],
  ['rm', rmBroad],
  [
    'dd',
    (v, emit) => {
      if (v.values.some((a) => a.startsWith('of=/dev/') && !a.startsWith('of=/dev/null')))
        emit('destructive', 'dd to a device', 'high');
    },
  ],
  [
    'diskutil',
    (v, emit) => {
      if (
        v.values.some((a) => /^(eraseDisk|eraseVolume|zeroDisk|secureErase|partitionDisk)$/.test(a))
      )
        emit('destructive', `diskutil ${v.values[0] ?? ''}`, 'high');
    },
  ],
  ['shred', (_v, emit) => emit('destructive', 'shred', 'medium')],
]);

for (const p of ['mkfs', 'mkfs.ext4', 'mkfs.xfs', 'mkfs.btrfs', 'mkfs.vfat', 'newfs']) {
  PROGRAM_SIGNALS.set(p, (_v, emit) => emit('destructive', p, 'high'));
}

function git(v: CommandView, emit: Emit, context: SignalContext): void {
  const { sub, args, configs } = gitParts(v, context.home);
  const values = args.map((w) => w.value);
  // One-shot `-c` settings can bypass checks for this command but do not persist.
  for (const c of configs) gitConfigPair(c.replace(/^--config-env=?/, ''), null, emit, true);
  if (
    GIT_VERIFY_SKIPPABLE.has(sub) &&
    (values.includes('--no-verify') ||
      (sub === 'commit' && hasOpt(parseArgs(args, { short: 'mFCcSt' }), '-n')))
  ) {
    emit('safety_bypass', `git ${sub} --no-verify`, 'high');
  }
  if (sub === 'config') gitConfig(args, emit);
  else if (sub === 'reset' && values.includes('--hard'))
    emit('destructive', 'git reset --hard', 'high');
  else if (sub === 'clean') {
    const items = parseArgs(args, { short: 'e' });
    if (hasOpt(items, '-f', '--force') && hasOpt(items, '-d', '-x', '-X'))
      emit('destructive', 'git clean -fd', 'high');
  } else if (sub === 'push') {
    const items = parseArgs(args, { short: 'o' });
    if (
      hasOpt(items, '-f', '--force', '--force-with-lease', '--mirror') ||
      values.some((a) => a.startsWith('--force-with-lease=') || /^\+[^+]/.test(a))
    ) {
      emit('destructive', 'git push --force', 'high');
    }
    if (values.includes('--delete') || values.some((a) => /^:[^:]/.test(a)))
      emit('destructive', 'git push --delete', 'medium');
  } else if (
    sub === 'checkout' &&
    values.includes('--') &&
    (values.at(-1) === '.' || values.at(-1) === ':/')
  ) {
    emit('destructive', 'git checkout -- .', 'medium');
  } else if (sub === 'checkout' && values.length === 1 && values[0] === '.') {
    emit('destructive', 'git checkout .', 'medium');
  } else if (
    sub === 'restore' &&
    !values.includes('--staged') &&
    (values.includes('.') || values.includes(':/'))
  ) {
    emit('destructive', 'git restore .', 'medium');
  } else if (
    sub === 'branch' &&
    (values.includes('-D') || (values.includes('-d') && values.includes('--force')))
  ) {
    emit('destructive', 'git branch -D', 'medium');
  } else if (sub === 'stash' && values[0] === 'clear') {
    emit('destructive', 'git stash clear', 'medium');
  } else if (sub === 'filter-branch' || sub === 'filter-repo') {
    emit('destructive', `git ${sub}`, 'medium');
  } else if (sub === 'credential' && (values[0] === 'fill' || values[0] === 'get')) {
    emit('credential_command', 'git credential fill', 'high');
  }
}

/** `git config [scope options] key value`, `git config set key value`, and read/unset forms (ignored). */
function gitConfig(args: readonly Word[], emit: Emit): void {
  const items = parseArgs(args, {
    short: 'f',
    long: ['--file', '--blob', '--type', '--default', '--comment', '--value'],
  });
  if (
    hasOpt(
      items,
      '--get',
      '--get-all',
      '--get-regexp',
      '--get-urlmatch',
      '--list',
      '-l',
      '--unset',
      '--unset-all',
      '--remove-section',
      '--rename-section',
      '-e',
      '--edit',
    )
  ) {
    if (hasOpt(items, '-e', '--edit')) emit('persistence_command', 'git config --edit', 'low');
    return;
  }
  let ops = operandsOf(items).map((w) => w.value);
  if (
    ops[0] === 'get' ||
    ops[0] === 'list' ||
    ops[0] === 'unset' ||
    ops[0] === 'remove-section' ||
    ops[0] === 'rename-section'
  )
    return;
  if (ops[0] === 'set') ops = ops.slice(1);
  if (ops[0] === 'edit') {
    emit('persistence_command', 'git config edit', 'low');
    return;
  }
  const [key, value] = ops;
  if (key === undefined || value === undefined) return;
  gitConfigPair(key, value, emit);
}

/** Classifies one `key=value` (from `-c`) or one key and value. */
function gitConfigPair(
  keyOrPair: string,
  value: string | null,
  emit: Emit,
  transient = false,
): void {
  let key = keyOrPair;
  let val = value;
  if (val === null) {
    const eq = keyOrPair.indexOf('=');
    key = eq === -1 ? keyOrPair : keyOrPair.slice(0, eq);
    val = eq === -1 ? 'true' : keyOrPair.slice(eq + 1);
  }
  const k = key.toLowerCase();
  if (k === 'core.hookspath' && (val === '' || val === '/dev/null')) {
    emit('safety_bypass', 'git hooks disabled (core.hooksPath)', 'high');
  } else if (k === 'http.sslverify' && /^(false|no|off|0)$/i.test(val)) {
    emit('safety_bypass', 'git http.sslVerify=false', 'high');
  } else if (transient) {
    return;
  } else if (k.startsWith('alias.')) {
    if (val.startsWith('!')) emit('persistence_command', `git config ${key}`, 'high');
  } else if (GIT_PERSIST_KEY.test(k)) {
    emit('persistence_command', `git config ${key}`, 'high');
  }
}

function pipBypass(v: CommandView, emit: Emit): void {
  if (v.values.some((a) => a === '--trusted-host' || a.startsWith('--trusted-host='))) {
    emit('safety_bypass', `${v.program} --trusted-host`, 'high');
  }
}

function npmConfig(v: CommandView, emit: Emit): void {
  const ops = v.values.filter((a) => !a.startsWith('-'));
  if (ops[0] !== 'config' || ops[1] !== 'set') return;
  const joined = ops.slice(2).join(' ').toLowerCase();
  if (/strict-ssl[ =]false/.test(joined))
    emit('safety_bypass', `${v.program} config set strict-ssl false`, 'high');
  if (/ignore-scripts[ =]false/.test(joined))
    emit('safety_bypass', `${v.program} config set ignore-scripts false`, 'low');
  if (/script-shell[ =]/.test(joined))
    emit('persistence_command', `${v.program} config set script-shell`, 'high');
}

/** World-writable modes and setuid or setgid bits. */
function chmod(v: CommandView, emit: Emit): void {
  const items = parseArgs(v.args, { long: ['--reference'] });
  const mode = operandsOf(items)[0]?.value ?? optValue(items, '--reference')?.value ?? '';
  const octal = /^[0-7]{3,4}$/.exec(mode);
  if (octal !== null) {
    const digits = mode.padStart(4, '0');
    const special = Number(digits[0]);
    const other = Number(digits[3]);
    if (special & 6) emit('privilege', `chmod ${mode} (setuid or setgid)`, 'high');
    if (other & 2)
      emit('privilege', `chmod ${mode} (world-writable)`, mode.endsWith('777') ? 'high' : 'medium');
    return;
  }
  for (const clause of mode.split(',')) {
    const m = /^([ugoa]*)([+=])([rwxXst]*)$/.exec(clause);
    if (m === null) continue;
    const who = m[1] ?? '';
    const perms = m[3] ?? '';
    if (perms.includes('s')) emit('privilege', `chmod ${clause} (setuid or setgid)`, 'high');
    if (perms.includes('w') && (who.includes('o') || who.includes('a')))
      emit('privilege', `chmod ${clause} (world-writable)`, 'medium');
  }
}

function chownRoot(v: CommandView, emit: Emit): void {
  const owner = operandsOf(parseArgs(v.args, { long: ['--reference', '--from'] }))[0]?.value ?? '';
  if (
    /^(root|0)([:.]|$)/.test(owner) ||
    (v.program === 'chgrp' && /^(wheel|root|0)$/.test(owner))
  ) {
    emit('privilege', `${v.program} ${owner}`, 'high');
  }
}

/** `echo $GITHUB_TOKEN` and similar: printing a variable whose name looks like a credential. */
function echoSecret(v: CommandView, emit: Emit): void {
  for (const w of v.args) {
    for (const m of w.raw.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const name = m[1] ?? '';
      if (CREDENTIAL_ENV_NAME.test(name)) {
        emit('credential_command', `${v.program} $${name}`, 'medium');
        return;
      }
    }
  }
}

/** Recursive deletes of a root, the home directory, a top-level directory, everything in cwd, or `.git`. */
function rmBroad(v: CommandView, emit: Emit, context: SignalContext): void {
  const items: ArgItem[] = parseArgs(v.args);
  if (!hasOpt(items, '-r', '-R', '--recursive')) return;
  for (const w of operandsOf(items)) {
    const raw = w.raw.replace(/^["']|["']$/g, '');
    const resolved = resolveWord(w, v.cwd, context.home);
    const path = resolved?.path ?? '';
    const broad =
      BROAD_DELETE_NAMES.has(raw) ||
      BROAD_DELETE_NAMES.has(w.value) ||
      path === '/' ||
      path === context.home ||
      TOP_LEVEL_DIRS.has(path) ||
      path.endsWith('/.git') ||
      (w.glob && /(^|\/)\*$/.test(w.value) && (path === `${context.home}/*` || path === '/*'));
    if (broad) {
      emit('destructive', `rm -r ${capText(raw, 60)}`, 'high');
      return;
    }
  }
}

/** Stopping, killing, or uninstalling Stillwatch, or deleting its data. */
function tampering(v: CommandView, emit: Emit): void {
  if (v.program === 'stillwatch') {
    const sub = v.values.find((a) => !a.startsWith('-')) ?? '';
    if (['uninstall', 'stop', 'delete-data'].includes(sub))
      emit('monitor_tampering', `stillwatch ${sub}`, 'high');
    return;
  }
  const mentions = v.values.some((a) => /stillwatch/i.test(a));
  if (!mentions) return;
  if (['kill', 'pkill', 'killall'].includes(v.program))
    emit('monitor_tampering', `${v.program} stillwatch`, 'high');
  else if (v.program === 'launchctl' || v.program === 'systemctl') {
    const sub = operandsOf(parseArgs(v.args)).at(0)?.value ?? '';
    if (['unload', 'bootout', 'disable', 'stop', 'remove', 'kill', 'mask'].includes(sub)) {
      emit('monitor_tampering', `${v.program} ${sub} stillwatch`, 'high');
    }
  }
}

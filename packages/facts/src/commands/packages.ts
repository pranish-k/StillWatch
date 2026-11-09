/**
 * Package manager commands that add, remove, install, or update packages.
 */
import type { PackageChange } from '@stillwatch/schema';
import { operandsOf, optValues, parseArgs, type ArgItem } from '../shell/args';
import { PYTHON_RE, type CommandView } from './view';

type Action = PackageChange['action'];

const MAX_NAMES = 20;
const MAX_NAME_LENGTH = 100;

const NPM_INSTALL = new Set([
  'install',
  'i',
  'in',
  'ins',
  'inst',
  'insta',
  'instal',
  'isnt',
  'isnta',
  'isntal',
  'isntall',
  'add',
]);
const NPM_CI = new Set(['ci', 'clean-install', 'ic', 'install-clean', 'isntall-clean']);
const REMOVE = new Set([
  'uninstall',
  'remove',
  'rm',
  'r',
  'un',
  'unlink',
  'erase',
  'purge',
  'autoremove',
]);
const UPDATE = new Set(['update', 'up', 'upgrade', 'udpate', 'dist-upgrade', 'full-upgrade']);
const GLOBAL_FLAGS = ['-g', '--global'];
const JS_VALUE_OPTS = [
  '--registry',
  '--prefix',
  '--workspace',
  '--tag',
  '--cache',
  '--userconfig',
  '--filter',
  '--dir',
  '--cwd',
  '--otp',
];
const PIP_VALUE_OPTS = [
  '--requirement',
  '--constraint',
  '--editable',
  '--index-url',
  '--extra-index-url',
  '--target',
  '--trusted-host',
  '--find-links',
  '--prefix',
  '--root',
  '--python-version',
  '--platform',
  '--python',
];

function change(manager: string, action: Action, names: string[]): PackageChange {
  return {
    manager,
    action,
    names: names.slice(0, MAX_NAMES).map((n) => n.slice(0, MAX_NAME_LENGTH)),
  };
}

function names(items: readonly ArgItem[], from = 1): string[] {
  return operandsOf(items)
    .slice(from)
    .map((w) => w.value);
}

function has(items: readonly ArgItem[], ...flags: string[]): boolean {
  return items.some(
    (i) =>
      i.kind === 'opt' &&
      (flags.includes(i.name) || (i.name === '--location' && i.value?.value === 'global')),
  );
}

function jsManager(manager: string, items: ArgItem[]): PackageChange | null {
  const ops = operandsOf(items).map((w) => w.value);
  let sub = ops[0];
  let rest = names(items);
  let global = has(items, ...GLOBAL_FLAGS);
  if (manager === 'yarn') {
    if (sub === 'global') {
      global = true;
      sub = ops[1];
      rest = names(items, 2);
    }
    if (sub === undefined) return change(manager, 'install', []);
  }
  if (sub === undefined) return null;
  if (sub === 'dlx' || sub === 'x' || sub === 'exec')
    return change(manager, 'add', rest.slice(0, 1));
  if (NPM_INSTALL.has(sub) || sub === 'a') {
    if (rest.length === 0) return change(manager, 'install', []);
    return change(manager, global ? 'global' : 'add', rest);
  }
  if (NPM_CI.has(sub)) return change(manager, 'install', []);
  if (REMOVE.has(sub)) return change(manager, 'remove', rest);
  if (UPDATE.has(sub)) return change(manager, 'update', rest);
  return null;
}

function pipLike(manager: string, args: CommandView['args']): PackageChange | null {
  const items = parseArgs(args, { short: 'rceitf', long: PIP_VALUE_OPTS });
  const sub = operandsOf(items)[0]?.value;
  const pkgs = [...names(items), ...optValues(items, '-e', '--editable').map((w) => w.value)];
  if (sub === 'install') {
    if (has(items, '-U', '--upgrade')) return change(manager, 'update', pkgs);
    return change(manager, pkgs.length > 0 ? 'add' : 'install', pkgs);
  }
  if (sub === 'uninstall') return change(manager, 'remove', pkgs);
  return null;
}

/** Simple `<tool> <sub> names...` managers: subcommand to action. */
const SIMPLE: Record<string, Record<string, Action>> = {
  poetry: { add: 'add', remove: 'remove', install: 'install', update: 'update' },
  pipx: { install: 'global', uninstall: 'remove', upgrade: 'update', inject: 'add', run: 'add' },
  cargo: {
    add: 'add',
    remove: 'remove',
    rm: 'remove',
    install: 'global',
    uninstall: 'remove',
    update: 'update',
  },
  gem: { install: 'global', i: 'global', uninstall: 'remove', update: 'update' },
  brew: {
    install: 'global',
    reinstall: 'global',
    uninstall: 'remove',
    remove: 'remove',
    rm: 'remove',
    upgrade: 'update',
  },
  apt: {
    install: 'global',
    remove: 'remove',
    purge: 'remove',
    autoremove: 'remove',
    upgrade: 'update',
    'dist-upgrade': 'update',
    'full-upgrade': 'update',
  },
  dnf: {
    install: 'global',
    remove: 'remove',
    erase: 'remove',
    update: 'update',
    upgrade: 'update',
  },
};
SIMPLE['apt-get'] = SIMPLE.apt ?? {};
SIMPLE.aptitude = SIMPLE.apt ?? {};
SIMPLE.yum = SIMPLE.dnf ?? {};

const MANAGER_NAME: Record<string, string> = { 'apt-get': 'apt', aptitude: 'apt', pip3: 'pip' };

export function packageChange(v: CommandView): PackageChange | null {
  const program = v.program;
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) {
    return jsManager(program, parseArgs(v.args, { short: 'wC', long: JS_VALUE_OPTS }));
  }
  if (program === 'npx' || program === 'bunx' || program === 'pnpx' || program === 'uvx') {
    const items = parseArgs(v.args, {
      short: 'pc',
      long: ['--package', '--call', '--from', '--with'],
    });
    const first = operandsOf(items)[0]?.value;
    const pkgs = [...optValues(items, '-p', '--package', '--from').map((w) => w.value)];
    if (first !== undefined && pkgs.length === 0) pkgs.push(first);
    return pkgs.length > 0 ? change(program === 'uvx' ? 'uv' : program, 'add', pkgs) : null;
  }
  if (program === 'pip' || program === 'pip3') return pipLike('pip', v.args);
  if (PYTHON_RE.test(program)) {
    const m = v.values.indexOf('-m');
    if (m !== -1 && v.values[m + 1] === 'pip') return pipLike('pip', v.args.slice(m + 2));
    return null;
  }
  if (program === 'uv') {
    const ops = operandsOf(
      parseArgs(v.args, { long: ['--python', '--project', '--directory', '--index-url'] }),
    );
    const [sub, sub2] = ops.map((w) => w.value);
    if (sub === 'pip') return pipLike('uv', v.args.slice(v.values.indexOf('pip') + 1));
    if (sub === 'add')
      return change(
        'uv',
        'add',
        ops.slice(1).map((w) => w.value),
      );
    if (sub === 'remove')
      return change(
        'uv',
        'remove',
        ops.slice(1).map((w) => w.value),
      );
    if (sub === 'sync') return change('uv', 'install', []);
    if (sub === 'tool' && sub2 === 'install')
      return change(
        'uv',
        'global',
        ops.slice(2).map((w) => w.value),
      );
    if (sub === 'tool' && sub2 === 'uninstall')
      return change(
        'uv',
        'remove',
        ops.slice(2).map((w) => w.value),
      );
    return null;
  }
  if (program === 'go') {
    const ops = operandsOf(parseArgs(v.args)).map((w) => w.value);
    if (ops[0] === 'get') return change('go', 'add', ops.slice(1));
    if (ops[0] === 'install') return change('go', 'global', ops.slice(1));
    if (ops[0] === 'mod' && ops[1] === 'download') return change('go', 'install', ops.slice(2));
    return null;
  }
  const table = SIMPLE[program];
  if (table === undefined) return null;
  const ops = operandsOf(parseArgs(v.args)).map((w) => w.value);
  const action = ops[0] === undefined ? undefined : table[ops[0]];
  if (action === undefined) return null;
  const rest = ops.slice(1);
  return change(
    MANAGER_NAME[program] ?? program,
    action === 'install' && rest.length > 0 ? 'add' : action,
    rest,
  );
}

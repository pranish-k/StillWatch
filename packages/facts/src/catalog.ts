/**
 * The catalog of sensitive and persistent locations. Entries are anchored to
 * the home directory, to absolute system paths, to the Stillwatch data
 * directory, or match anywhere by name or trailing path segments. Matching is
 * case-insensitive because the default macOS file system is.
 */
import {
  canonicalPath,
  PATH_CLASSES,
  pathKey,
  relativeTo,
  type PathClass,
  type PathClassification,
  type PathScope,
} from '@stillwatch/schema';

export type CatalogContext = { home: string; stillwatchHome: string; repoRoots: string[] };

type PathInfo = {
  /** Lowercased path key. */
  key: string;
  segs: string[];
  base: string;
  /** Lowercased segments relative to home, or null outside it. */
  homeRel: string[] | null;
  /** Lowercased segments relative to the Stillwatch home, or null outside it. */
  swRel: string[] | null;
};

type Matcher = (p: PathInfo) => boolean;
type Entry = { classes: PathClass[]; label: string; match: Matcher };

function lowerSegs(path: string): string[] {
  return path
    .toLowerCase()
    .split('/')
    .filter((s) => s !== '');
}

function relSegs(key: string, base: string): string[] | null {
  const rel = relativeTo(key, pathKey(base).toLowerCase());
  if (rel === null) return null;
  return rel === '.' ? [] : rel.split('/');
}

function globRe(glob: string): RegExp {
  const body = glob
    .toLowerCase()
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${body}$`);
}

function startsWithSegs(segs: readonly string[], prefix: readonly string[]): boolean {
  if (segs.length < prefix.length) return false;
  return prefix.every((p, i) => segs[i] === p);
}

// Matchers --------------------------------------------------------------------

/** Exact path relative to home. */
const home =
  (rel: string): Matcher =>
  (p) => {
    const want = lowerSegs(rel);
    return (
      p.homeRel !== null && p.homeRel.length === want.length && startsWithSegs(p.homeRel, want)
    );
  };

/** Anything under a home-relative directory (and the directory itself). */
const homeIn =
  (rel: string): Matcher =>
  (p) =>
    p.homeRel !== null && startsWithSegs(p.homeRel, lowerSegs(rel));

/** Home-relative glob, segment by segment, e.g. ".claude/projects/ * /memory". */
const homeGlob = (...globs: string[]): Matcher => {
  const res = globs.map(globRe);
  return (p) =>
    p.homeRel !== null &&
    p.homeRel.length >= res.length &&
    res.every((re, i) => re.test(p.homeRel?.[i] ?? ''));
};

const abs =
  (path: string): Matcher =>
  (p) =>
    p.key === path.toLowerCase();

const absIn =
  (dir: string): Matcher =>
  (p) =>
    startsWithSegs(p.segs, lowerSegs(dir));

/** Basename matches one of the globs. */
const named = (...globs: string[]): Matcher => {
  const res = globs.map(globRe);
  return (p) => res.some((re) => re.test(p.base));
};

/** The last segments match the globs, e.g. ".github", "workflows", "*.yml". */
const tail = (...globs: string[]): Matcher => {
  const res = globs.map(globRe);
  return (p) => {
    const offset = p.segs.length - res.length;
    return offset >= 0 && res.every((re, i) => re.test(p.segs[offset + i] ?? ''));
  };
};

/** The path is inside (or is) a directory with these consecutive segments, anywhere. */
const within =
  (...dir: string[]): Matcher =>
  (p) => {
    const want = dir.map((d) => d.toLowerCase());
    for (let i = 0; i + want.length <= p.segs.length; i++) {
      if (want.every((w, k) => p.segs[i + k] === w)) return true;
    }
    return false;
  };

const swAt =
  (rel: string): Matcher =>
  (p) => {
    const want = lowerSegs(rel);
    return p.swRel !== null && p.swRel.length === want.length && startsWithSegs(p.swRel, want);
  };

const not =
  (m: Matcher): Matcher =>
  (p) =>
    !m(p);
const all =
  (...ms: Matcher[]): Matcher =>
  (p) =>
    ms.every((m) => m(p));
const any =
  (...ms: Matcher[]): Matcher =>
  (p) =>
    ms.some((m) => m(p));

function e(classes: PathClass | PathClass[], label: string, match: Matcher): Entry {
  return { classes: Array.isArray(classes) ? classes : [classes], label, match };
}

const SHELL_PROFILES = [
  '.zshrc',
  '.zshenv',
  '.zprofile',
  '.zlogin',
  '.zlogout',
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.bash_logout',
  '.bash_aliases',
  '.profile',
  '.kshrc',
];

/** Commands people run constantly; a copy earlier in PATH sees every use. */
const SHADOWED_COMMANDS = [
  'git',
  'ssh',
  'scp',
  'sudo',
  'su',
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'python',
  'python3',
  'pip',
  'pip3',
  'ls',
  'cat',
  'curl',
  'gpg',
  'docker',
  'kubectl',
  'aws',
  'gh',
  'claude',
  'make',
];

/** Catalog in order of specificity: the first match supplies the label. */
const CATALOG: Entry[] = [
  // Stillwatch's own data.
  e('stillwatch', 'Stillwatch hook script', swAt('bin/hook.sh')),
  e('stillwatch', 'Stillwatch config', swAt('config.json')),
  e(
    'stillwatch',
    'Stillwatch database',
    all((p) => p.swRel?.length === 1, named('stillwatch.db', 'stillwatch.db-*')),
  ),
  e('stillwatch', 'Stillwatch data', (p) => p.swRel !== null),

  // Credentials with exact home locations.
  e('secret', 'Claude Code credentials', home('.claude/.credentials.json')),
  e('secret', 'Codex credentials', home('.codex/auth.json')),
  e('secret', 'AWS credentials', home('.aws/credentials')),
  e('secret', 'AWS config', home('.aws/config')),
  e('secret', 'Kubernetes config', home('.kube/config')),
  e('secret', 'Docker registry credentials', home('.docker/config.json')),
  e('secret', 'npm user config with registry tokens', home('.npmrc')),
  e('secret', 'PyPI credentials', home('.pypirc')),
  e('secret', 'netrc credentials', home('.netrc')),
  e('secret', 'Git credential store', home('.git-credentials')),
  e('secret', 'GitHub CLI token', home('.config/gh/hosts.yml')),
  e(['secret', 'startup_file'], 'SSH client config', home('.ssh/config')),
  e(['secret', 'startup_file'], 'SSH login script', home('.ssh/rc')),
  e(
    ['secret', 'startup_file'],
    'SSH authorized keys',
    any(home('.ssh/authorized_keys'), home('.ssh/authorized_keys2')),
  ),
  e(
    'secret',
    'SSH private key',
    named('id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'id_ecdsa_sk', 'id_ed25519_sk'),
  ),
  e('secret', 'Google Cloud credentials', homeIn('.config/gcloud')),
  e('secret', 'Azure CLI credentials', homeIn('.azure')),
  e('secret', 'GnuPG keyring', homeIn('.gnupg')),
  e('secret', 'pass password store', homeIn('.password-store')),
  e('secret', 'macOS keychain', homeIn('Library/Keychains')),
  e(
    'secret',
    'SSH directory',
    all(homeIn('.ssh'), not(named('known_hosts', 'known_hosts.old', '*.pub'))),
  ),
  e(['secret', 'task_runner'], 'direnv file', named('.envrc')),
  e(
    'secret',
    'environment file',
    all(
      named('.env', '.env.*'),
      not(
        named(
          '*.example',
          '*.sample',
          '*.template',
          '.env.example.*',
          '.env.sample.*',
          '.env.template.*',
        ),
      ),
    ),
  ),
  e('secret', 'PEM key or certificate', named('*.pem')),
  e('secret', 'private key file', named('*.key')),
  e('secret', 'PKCS#12 keystore', named('*.p12', '*.pfx')),
  e('secret', 'Java keystore', named('*.jks', '*.keystore')),
  e('secret', 'Terraform state', named('*.tfstate', '*.tfstate.backup')),
  e('secret', 'credentials file', named('credentials.json')),
  e(
    'secret',
    'browser cookies or saved passwords',
    all(
      named(
        'cookies',
        'cookies.sqlite',
        'login data',
        'login data for account',
        'web data',
        'logins.json',
        'key4.db',
        'key3.db',
      ),
      any(
        within('google', 'chrome'),
        within('google-chrome'),
        within('chromium'),
        within('bravesoftware'),
        within('microsoft edge'),
        within('microsoft-edge'),
        within('firefox'),
        within('.mozilla'),
        within('arc', 'user data'),
      ),
    ),
  ),
  e('secret', 'service account key', named('service-account*.json')),

  // Git hooks and config.
  e('git_hook', 'Git hook', all(within('.git', 'hooks'), not(named('*.sample')))),
  e('git_hook', 'Husky hook', within('.husky')),
  e(
    'git_hook',
    'Lefthook config',
    named('lefthook.yml', '.lefthook.yml', 'lefthook-local.yml', 'lefthook.yaml'),
  ),
  e('git_hook', 'pre-commit config', named('.pre-commit-config.yaml', '.pre-commit-config.yml')),
  e('git_config', 'global Git config', any(home('.gitconfig'), home('.config/git/config'))),
  e('git_config', 'global Git attributes', home('.config/git/attributes')),
  e('git_config', 'Git repository config', tail('.git', 'config')),
  e(
    'git_config',
    'Git attributes',
    any(tail('.git', 'info', 'attributes'), named('.gitattributes')),
  ),
  e('git_config', 'Git submodules', named('.gitmodules')),

  // CI pipelines.
  e('ci', 'GitHub Actions workflow', tail('.github', 'workflows', '*.y*ml')),
  e('ci', 'GitHub Action definition', within('.github', 'actions')),
  e(
    'ci',
    'GitLab CI pipeline',
    any(named('.gitlab-ci.yml', '.gitlab-ci.yaml'), within('.gitlab', 'ci')),
  ),
  e('ci', 'CircleCI config', within('.circleci')),
  e('ci', 'Jenkins pipeline', named('jenkinsfile', '*.jenkinsfile')),
  e(
    'ci',
    'Azure Pipelines',
    named('azure-pipelines.yml', 'azure-pipelines.yaml', 'azure-pipelines-*.yml'),
  ),
  e('ci', 'Bitbucket Pipelines', named('bitbucket-pipelines.yml')),
  e('ci', 'Buildkite pipeline', within('.buildkite')),
  e('ci', 'Drone CI', named('.drone.yml', '.drone.yaml')),
  e('ci', 'Travis CI', named('.travis.yml')),
  e(
    'ci',
    'Woodpecker CI',
    any(named('.woodpecker.yml', '.woodpecker.yaml'), within('.woodpecker')),
  ),
  e('ci', 'Google Cloud Build', named('cloudbuild.yaml', 'cloudbuild.yml', 'cloudbuild.json')),

  // Scheduled tasks.
  e('scheduled_task', 'system crontab', any(abs('/etc/crontab'), abs('/etc/anacrontab'))),
  e(
    'scheduled_task',
    'cron directory',
    (p) => p.segs[0] === 'etc' && (p.segs[1] ?? '').startsWith('cron.'),
  ),
  e(
    'scheduled_task',
    'user crontab',
    any(absIn('/var/spool/cron'), absIn('/usr/lib/cron/tabs'), absIn('/var/at/tabs')),
  ),
  e('scheduled_task', 'user launch agent', homeIn('Library/LaunchAgents')),
  e('scheduled_task', 'system launch agent', absIn('/Library/LaunchAgents')),
  e('scheduled_task', 'launch daemon', absIn('/Library/LaunchDaemons')),
  e('scheduled_task', 'user systemd unit', homeIn('.config/systemd/user')),
  e(
    'scheduled_task',
    'systemd unit',
    any(absIn('/etc/systemd/system'), absIn('/etc/systemd/user')),
  ),
  e(
    'scheduled_task',
    'autostart entry',
    any(homeIn('.config/autostart'), absIn('/etc/xdg/autostart')),
  ),

  // Startup files.
  e('startup_file', 'shell startup file', any(...SHELL_PROFILES.map((f) => home(f)))),
  e(
    'startup_file',
    'fish startup file',
    any(home('.config/fish/config.fish'), homeIn('.config/fish/conf.d')),
  ),
  e(
    'startup_file',
    'system shell startup file',
    any(
      ...[
        '/etc/profile',
        '/etc/zshrc',
        '/etc/zshenv',
        '/etc/zprofile',
        '/etc/zlogin',
        '/etc/bashrc',
        '/etc/bash.bashrc',
      ].map(abs),
      absIn('/etc/profile.d'),
    ),
  ),
  e('startup_file', 'Python startup hook', named('sitecustomize.py', 'usercustomize.py')),
  e(
    'startup_file',
    'program shadowing a system command',
    all(any(homeIn('.local/bin'), homeIn('bin')), named(...SHADOWED_COMMANDS)),
  ),
  e(
    'startup_file',
    'Python path file',
    all(named('*.pth'), any(within('site-packages'), within('dist-packages'))),
  ),

  // Agent configuration.
  e(
    'agent_config',
    'Claude Code user settings',
    any(home('.claude/settings.json'), home('.claude/settings.local.json')),
  ),
  e('agent_config', 'Claude Code user state', home('.claude.json')),
  e('agent_config', 'Claude Code local settings', tail('.claude', 'settings.local.json')),
  e('agent_config', 'Claude Code project settings', tail('.claude', 'settings.json')),
  e('agent_config', 'MCP server config', named('.mcp.json')),
  e('agent_config', 'Claude Code subagent', within('.claude', 'agents')),
  e('agent_config', 'Claude Code command', within('.claude', 'commands')),
  e('agent_config', 'Claude Code skill', within('.claude', 'skills')),
  e('agent_config', 'Claude Code hook script', within('.claude', 'hooks')),
  e(
    ['agent_config', 'memory_note'],
    'Claude Code rule',
    all(within('.claude', 'rules'), named('*.md')),
  ),
  e('agent_config', 'Claude Code rules', within('.claude', 'rules')),
  e('agent_config', 'Claude Code plugins', homeIn('.claude/plugins')),
  e('agent_config', 'Codex config', home('.codex/config.toml')),
  e('agent_config', 'Codex config', within('.codex')),
  e('agent_config', 'Cursor MCP config', tail('.cursor', 'mcp.json')),
  e('agent_config', 'VS Code MCP config', tail('.vscode', 'mcp.json')),
  e('agent_config', 'Gemini CLI settings', tail('.gemini', 'settings.json')),
  e('agent_config', 'Aider config', named('.aider.conf.yml')),

  // Memory and instruction files.
  e('memory_note', 'Claude auto memory', homeGlob('.claude', 'projects', '*', 'memory')),
  e('memory_note', 'Claude memory file', named('claude.md', 'claude.local.md')),
  e('memory_note', 'agent instructions', named('agents.md', 'agent.md', 'gemini.md')),
  e('memory_note', 'Cursor rules', any(named('.cursorrules'), within('.cursor', 'rules'))),
  e('memory_note', 'Windsurf rules', named('.windsurfrules')),
  e(
    'memory_note',
    'Copilot instructions',
    any(tail('.github', 'copilot-instructions.md'), within('.github', 'instructions')),
  ),
  e('memory_note', 'Cline rules', within('.clinerules')),
  e('memory_note', 'project notes', named('conventions.md', 'notes.md', 'handoff.md', 'todo.md')),

  // Task runners and manifests.
  e(['task_runner', 'package_manifest'], 'npm package manifest', named('package.json')),
  e(['task_runner', 'package_manifest'], 'Python project file', named('pyproject.toml')),
  e(['task_runner', 'package_manifest'], 'Python setup script', named('setup.py')),
  e('task_runner', 'Makefile', named('makefile', 'gnumakefile', '*.mk')),
  e('task_runner', 'justfile', named('justfile', '.justfile')),
  e('task_runner', 'Taskfile', named('taskfile.yml', 'taskfile.yaml', 'taskfile.dist.yml')),
  e('task_runner', 'VS Code tasks', tail('.vscode', 'tasks.json')),
  e('task_runner', 'VS Code workspace settings', tail('.vscode', 'settings.json')),
  e(
    'task_runner',
    'dev container config',
    any(within('.devcontainer'), named('.devcontainer.json')),
  ),
  e('task_runner', 'repository npm config', all(named('.npmrc'), not(home('.npmrc')))),
  e('task_runner', 'Yarn config', named('.yarnrc.yml', '.yarnrc')),
  e('task_runner', 'Cargo build script', named('build.rs')),
  e('task_runner', 'Cargo config', any(tail('.cargo', 'config.toml'), tail('.cargo', 'config'))),
  e('task_runner', 'tox config', named('tox.ini')),
  e('task_runner', 'pytest conftest', named('conftest.py')),
  e(
    'task_runner',
    'Python package index config',
    any(
      home('.config/pip/pip.conf'),
      home('.pip/pip.conf'),
      named('pip.ini'),
      home('.config/uv/uv.toml'),
      named('uv.toml'),
    ),
  ),
  e('task_runner', 'nox sessions', named('noxfile.py')),
  e(
    'package_manifest',
    'lockfile',
    named(
      'package-lock.json',
      'npm-shrinkwrap.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'bun.lockb',
      'bun.lock',
      'poetry.lock',
      'uv.lock',
      'pipfile.lock',
      'cargo.lock',
      'go.sum',
      'gemfile.lock',
      'composer.lock',
    ),
  ),
  e(
    'package_manifest',
    'dependency manifest',
    named('requirements*.txt', 'pipfile', 'cargo.toml', 'go.mod', 'gemfile', 'composer.json'),
  ),
];

const TEMP_DIRS = ['/tmp', '/var/folders'];
const SYSTEM_DIRS = [
  '/etc',
  '/library',
  '/system',
  '/usr',
  '/bin',
  '/sbin',
  '/opt',
  '/var',
  '/lib',
  '/lib64',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  '/srv',
  '/root',
  '/applications',
  '/private',
];

function within2(key: string, dir: string): boolean {
  return key === dir || key.startsWith(`${dir}/`);
}

function scopeOf(key: string, context: CatalogContext): PathScope {
  for (const root of context.repoRoots) {
    if (within2(key, pathKey(root).toLowerCase())) return 'repo';
  }
  if (TEMP_DIRS.some((d) => within2(key, d))) return 'temp';
  if (within2(key, pathKey(context.home).toLowerCase())) return 'home';
  if (SYSTEM_DIRS.some((d) => within2(key, d))) return 'system';
  return 'other';
}

export function classify(path: string, context: CatalogContext): PathClassification {
  const key = pathKey(canonicalPath(path)).toLowerCase();
  const segs = key.split('/').filter((s) => s !== '');
  const info: PathInfo = {
    key,
    segs,
    base: segs.at(-1) ?? '',
    homeRel: context.home === '' ? null : relSegs(key, context.home),
    swRel: context.stillwatchHome === '' ? null : relSegs(key, context.stillwatchHome),
  };
  const classes = new Set<PathClass>();
  let label: string | null = null;
  for (const entry of CATALOG) {
    if (!entry.match(info)) continue;
    label ??= entry.label;
    for (const c of entry.classes) classes.add(c);
  }
  return {
    classes: PATH_CLASSES.filter((c) => classes.has(c)),
    label,
    scope: scopeOf(key, context),
  };
}

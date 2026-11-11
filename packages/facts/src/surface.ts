/**
 * Persistence surface: the locations snapshotted at session start and end.
 * Labels come from the catalog so snapshots and file facts read the same.
 */
import {
  joinPath,
  stillwatchPaths,
  type PathClass,
  type RepoSurfaceSpec,
  type SurfaceSpec,
} from '@stillwatch/schema';
import { classify } from './catalog';

type Platform = 'darwin' | 'linux';
type HomeItem = { rel: string; kind: 'file' | 'dir'; class: PathClass; only?: Platform };

/**
 * Home entries worth hashing. `~/.claude.json` is left out on purpose:
 * Claude Code rewrites it on every run, so it would always look changed.
 */
const HOME_ITEMS: HomeItem[] = [
  ...[
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
    '.config/fish/config.fish',
  ].map((rel): HomeItem => ({ rel, kind: 'file', class: 'startup_file' })),
  { rel: '.config/fish/conf.d', kind: 'dir', class: 'startup_file' },
  { rel: '.ssh/rc', kind: 'file', class: 'startup_file' },
  { rel: '.ssh/config', kind: 'file', class: 'startup_file' },
  { rel: '.ssh/authorized_keys', kind: 'file', class: 'startup_file' },
  { rel: '.gitconfig', kind: 'file', class: 'git_config' },
  { rel: '.config/git/config', kind: 'file', class: 'git_config' },
  { rel: '.config/git/attributes', kind: 'file', class: 'git_config' },
  { rel: '.npmrc', kind: 'file', class: 'secret' },
  { rel: '.config/pip/pip.conf', kind: 'file', class: 'task_runner' },
  { rel: '.pip/pip.conf', kind: 'file', class: 'task_runner' },
  { rel: '.claude/settings.json', kind: 'file', class: 'agent_config' },
  { rel: '.claude/settings.local.json', kind: 'file', class: 'agent_config' },
  { rel: '.claude/agents', kind: 'dir', class: 'agent_config' },
  { rel: '.claude/commands', kind: 'dir', class: 'agent_config' },
  { rel: '.claude/skills', kind: 'dir', class: 'agent_config' },
  { rel: '.claude/hooks', kind: 'dir', class: 'agent_config' },
  { rel: '.claude/rules', kind: 'dir', class: 'agent_config' },
  { rel: '.claude/CLAUDE.md', kind: 'file', class: 'memory_note' },
  { rel: '.codex/config.toml', kind: 'file', class: 'agent_config' },
  { rel: '.cursor/mcp.json', kind: 'file', class: 'agent_config' },
  { rel: '.gemini/settings.json', kind: 'file', class: 'agent_config' },
  { rel: '.aider.conf.yml', kind: 'file', class: 'agent_config' },
  { rel: 'Library/LaunchAgents', kind: 'dir', class: 'scheduled_task', only: 'darwin' },
  { rel: '.config/systemd/user', kind: 'dir', class: 'scheduled_task', only: 'linux' },
  { rel: '.config/autostart', kind: 'dir', class: 'scheduled_task', only: 'linux' },
];

type SystemItem = { path: string; kind: 'file' | 'dir'; class: PathClass; only?: Platform };

const SYSTEM_ITEMS: SystemItem[] = [
  { path: '/etc/crontab', kind: 'file', class: 'scheduled_task' },
  { path: '/etc/cron.d', kind: 'dir', class: 'scheduled_task' },
  { path: '/Library/LaunchAgents', kind: 'dir', class: 'scheduled_task', only: 'darwin' },
  { path: '/Library/LaunchDaemons', kind: 'dir', class: 'scheduled_task', only: 'darwin' },
  { path: '/etc/zshrc', kind: 'file', class: 'startup_file', only: 'darwin' },
  { path: '/etc/systemd/system', kind: 'dir', class: 'scheduled_task', only: 'linux' },
  { path: '/etc/profile.d', kind: 'dir', class: 'startup_file', only: 'linux' },
];

export type SurfaceInput = {
  home: string;
  stillwatchHome: string;
  includeSystem: boolean;
  platform: Platform;
};

export function buildPersistenceSurface(context: SurfaceInput): SurfaceSpec[] {
  const catalog = { home: context.home, stillwatchHome: context.stillwatchHome, repoRoots: [] };
  const labelOf = (path: string, fallback: string): string =>
    classify(path, catalog).label ?? fallback;
  const out: SurfaceSpec[] = [];
  const add = (path: string, kind: 'file' | 'dir', cls: PathClass): void => {
    out.push({ path, kind, class: cls, label: labelOf(path, path), argv: null });
  };
  for (const item of HOME_ITEMS) {
    if (item.only !== undefined && item.only !== context.platform) continue;
    add(joinPath(context.home, item.rel), item.kind, item.class);
  }
  const sw = stillwatchPaths(context.stillwatchHome);
  add(sw.hookScript, 'file', 'stillwatch');
  add(sw.config, 'file', 'stillwatch');
  if (context.includeSystem) {
    out.push({
      path: 'crontab',
      kind: 'command',
      class: 'scheduled_task',
      label: 'user crontab',
      argv: ['crontab', '-l'],
    });
    for (const item of SYSTEM_ITEMS) {
      if (item.only !== undefined && item.only !== context.platform) continue;
      add(item.path, item.kind, item.class);
    }
  }
  return out;
}

export const REPO_SURFACE: readonly RepoSurfaceSpec[] = [
  { rel: '.', base: 'hooks_path', kind: 'dir', class: 'git_hook', label: 'Git hooks' },
  {
    rel: 'config',
    base: 'git_common_dir',
    kind: 'file',
    class: 'git_config',
    label: 'Git repository config',
  },
  {
    rel: 'info/attributes',
    base: 'git_common_dir',
    kind: 'file',
    class: 'git_config',
    label: 'Git attributes',
  },
  {
    rel: '.claude/settings.local.json',
    base: 'worktree',
    kind: 'file',
    class: 'agent_config',
    label: 'Claude Code local settings',
  },
  {
    rel: 'CLAUDE.local.md',
    base: 'worktree',
    kind: 'file',
    class: 'memory_note',
    label: 'Claude memory file',
  },
  {
    rel: '.mcp.json',
    base: 'worktree',
    kind: 'file',
    class: 'agent_config',
    label: 'MCP server config',
  },
  { rel: '.envrc', base: 'worktree', kind: 'file', class: 'task_runner', label: 'direnv file' },
];

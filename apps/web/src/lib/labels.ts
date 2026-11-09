/** Plain-language labels and icons for schema values shown in the dashboard. */
import type {
  ArtifactKind,
  Attribution,
  EventKind,
  FileChangeKind,
  GapSeverity,
  ToolCategory,
  UnfinishedItem,
} from '@stillwatch/schema';
import type { IconName } from '../ui/Icon';

export const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  git_hook: 'Git hook',
  git_config: 'Git config',
  ci: 'CI workflow',
  task_runner: 'Task runner',
  scheduled_task: 'Scheduled task',
  startup_file: 'Startup file',
  agent_config: 'Agent config',
  memory_note: 'Memory note',
  package_manifest: 'Package manifest',
  background_process: 'Background process',
  session_cron: 'Session schedule',
  stillwatch: 'Stillwatch file',
  other: 'Other',
};

export const CHANGE_LABEL: Record<FileChangeKind, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  type_changed: 'Type changed',
};

export const ATTRIBUTION_LABEL: Record<Attribution, string> = {
  tool: 'Agent tool',
  shell: 'Shell command',
  other_session: 'Another session',
  unattributed: 'Not in the log',
};

export const GAP_LABEL: Record<GapSeverity, string> = {
  info: 'Note',
  warning: 'Warning',
  critical: 'Critical',
};

export const UNFINISHED_LABEL: Record<UnfinishedItem['kind'], string> = {
  task: 'Task',
  turn: 'Turn',
  tool_call: 'Tool call',
  background_task: 'Background task',
  session_cron: 'Scheduled prompt',
};

const CATEGORY_ICON: Record<ToolCategory, IconName> = {
  shell: 'terminal',
  'file.read': 'file',
  'file.write': 'edit',
  'file.edit': 'edit',
  'file.search': 'search',
  notebook: 'edit',
  'web.fetch': 'globe',
  'web.search': 'globe',
  agent: 'agent',
  mcp: 'plug',
  task: 'list',
  plan: 'list',
  question: 'question',
  other: 'chip',
};

const KIND_ICON: Record<EventKind, IconName> = {
  'session.start': 'play',
  'session.end': 'stop',
  'prompt.submit': 'prompt',
  'prompt.expand': 'prompt',
  'tool.pre': 'chip',
  'tool.post': 'chip',
  'tool.failure': 'alert',
  'tool.batch': 'layers',
  'permission.request': 'lock',
  'permission.denied': 'lock',
  'subagent.start': 'agent',
  'subagent.stop': 'agent',
  'task.created': 'list',
  'task.completed': 'check',
  'turn.stop': 'check',
  'turn.failure': 'alert',
  'instructions.loaded': 'file',
  'config.change': 'gear',
  'cwd.change': 'folder',
  'directory.add': 'folder',
  'file.change': 'edit',
  'compact.pre': 'compress',
  'compact.post': 'compress',
  'model.switch': 'chip',
  notification: 'bell',
  unknown: 'question',
};

export function eventIcon(kind: EventKind, category: ToolCategory | null): IconName {
  if (category !== null && (kind === 'tool.pre' || kind === 'tool.post')) {
    return CATEGORY_ICON[category];
  }
  return KIND_ICON[kind];
}

/** Coarse groups for the timeline filter. */
export type EventGroup = 'prompt' | 'tool' | 'agent' | 'other';

export function eventGroup(kind: EventKind): EventGroup {
  switch (kind) {
    case 'prompt.submit':
    case 'prompt.expand':
      return 'prompt';
    case 'tool.pre':
    case 'tool.post':
    case 'tool.failure':
    case 'tool.batch':
    case 'permission.request':
    case 'permission.denied':
      return 'tool';
    case 'subagent.start':
    case 'subagent.stop':
    case 'turn.stop':
    case 'turn.failure':
    case 'task.created':
    case 'task.completed':
      return 'agent';
    case 'session.start':
    case 'session.end':
    case 'instructions.loaded':
    case 'config.change':
    case 'cwd.change':
    case 'directory.add':
    case 'file.change':
    case 'compact.pre':
    case 'compact.post':
    case 'model.switch':
    case 'notification':
    case 'unknown':
      return 'other';
  }
}

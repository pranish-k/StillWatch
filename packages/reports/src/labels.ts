/** Human labels for enum values. Exhaustive switches keep them complete. */
import type {
  AgentKind,
  Artifact,
  ArtifactKind,
  Attribution,
  CaptureGap,
  FileChangeKind,
  PathClass,
  RiskLevel,
  SessionLink,
  SessionStatus,
  Severity,
  UnfinishedItem,
} from '@stillwatch/schema';

const AGENT_NAMES: Record<AgentKind, string> = { 'claude-code': 'Claude Code' };

export function agentName(agent: AgentKind): string {
  return AGENT_NAMES[agent];
}

export function statusLabel(status: SessionStatus): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'finished':
      return 'Finished';
    case 'interrupted':
      return 'Interrupted';
  }
}

export function riskLabel(risk: RiskLevel): string {
  switch (risk) {
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    case 'unknown':
      return 'Unknown';
  }
}

export function severityLabel(severity: Severity): string {
  switch (severity) {
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
  }
}

export function gapSeverityLabel(severity: CaptureGap['severity']): string {
  switch (severity) {
    case 'info':
      return 'Info';
    case 'warning':
      return 'Warning';
    case 'critical':
      return 'Critical';
  }
}

export function gapSeverityRank(severity: CaptureGap['severity']): number {
  switch (severity) {
    case 'critical':
      return 3;
    case 'warning':
      return 2;
    case 'info':
      return 1;
  }
}

export function fileChangeLabel(change: FileChangeKind): string {
  switch (change) {
    case 'added':
      return 'added';
    case 'modified':
      return 'modified';
    case 'deleted':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    case 'type_changed':
      return 'type changed';
  }
}

/** Note for how a change is known, or null for the ordinary case (a file tool call). */
export function attributionNote(attribution: Attribution): string | null {
  switch (attribution) {
    case 'tool':
      return null;
    case 'shell':
      return 'via a shell command';
    case 'other_session':
      return 'by another session';
    case 'unattributed':
      return 'no recorded action explains it';
  }
}

export function pathClassLabel(cls: PathClass): string {
  switch (cls) {
    case 'secret':
      return 'secret';
    case 'git_hook':
      return 'git hook';
    case 'git_config':
      return 'git config';
    case 'ci':
      return 'CI pipeline';
    case 'task_runner':
      return 'task runner';
    case 'scheduled_task':
      return 'scheduled task';
    case 'startup_file':
      return 'startup file';
    case 'agent_config':
      return 'agent configuration';
    case 'memory_note':
      return 'memory note';
    case 'package_manifest':
      return 'package manifest';
    case 'stillwatch':
      return 'Stillwatch file';
  }
}

export function artifactKindLabel(kind: ArtifactKind): string {
  switch (kind) {
    case 'git_hook':
      return 'git hook';
    case 'git_config':
      return 'git config';
    case 'ci':
      return 'CI pipeline';
    case 'task_runner':
      return 'task runner';
    case 'scheduled_task':
      return 'scheduled task';
    case 'startup_file':
      return 'startup file';
    case 'agent_config':
      return 'agent configuration';
    case 'memory_note':
      return 'memory note';
    case 'package_manifest':
      return 'package manifest';
    case 'background_process':
      return 'background process';
    case 'session_cron':
      return 'session cron';
    case 'stillwatch':
      return 'Stillwatch file';
    case 'other':
      return 'other';
  }
}

/** True when an artifact's `path` is a file path rather than a description. */
export function artifactIsFile(kind: ArtifactKind): boolean {
  return kind !== 'background_process' && kind !== 'session_cron';
}

export function artifactChangeLabel(change: Artifact['change']): string {
  switch (change) {
    case 'created':
      return 'created';
    case 'modified':
      return 'modified';
    case 'deleted':
      return 'deleted';
    case 'running':
      return 'still running';
    case 'scheduled':
      return 'scheduled';
  }
}

export function unfinishedKindLabel(kind: UnfinishedItem['kind']): string {
  switch (kind) {
    case 'task':
      return 'Task';
    case 'turn':
      return 'Turn';
    case 'tool_call':
      return 'Tool call';
    case 'background_task':
      return 'Background task';
    case 'session_cron':
      return 'Session cron';
  }
}

/** Past-tense verb for what the loading session did with the file. */
export function linkVerb(kind: SessionLink['kind']): string {
  switch (kind) {
    case 'note_loaded':
      return 'loaded';
    case 'note_read':
      return 'read';
    case 'config_inherited':
      return 'used configuration';
  }
}

export function accessOpLabel(op: string): string {
  switch (op) {
    case 'read':
      return 'Read';
    case 'write':
      return 'Wrote';
    case 'delete':
      return 'Deleted';
    default:
      return op.length === 0 ? 'Accessed' : op.charAt(0).toUpperCase() + op.slice(1);
  }
}

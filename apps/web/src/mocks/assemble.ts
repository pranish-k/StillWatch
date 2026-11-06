/**
 * Turns hand-written fixture parts into the API shapes: SessionRecord,
 * SessionDetailResponse (with its SessionReport), and SessionSummary.
 */
import {
  REPORT_VERSION,
  severityRank,
  type AgentRecord,
  type Artifact,
  type CaptureGap,
  type DomainRecord,
  type EventView,
  type FileChange,
  type Finding,
  type ReportFinding,
  type RiskLevel,
  type SensitiveAccess,
  type SessionDetailResponse,
  type SessionLinkView,
  type SessionRecord,
  type SessionStatus,
  type SessionSummary,
  type UnfinishedItem,
} from '@stillwatch/schema';

export type MockSession = {
  summary: SessionSummary;
  detail: SessionDetailResponse;
  events: EventView[];
};

export type FixtureParts = {
  id: string;
  title: string | null;
  projectName: string | null;
  projectRoot: string | null;
  status: SessionStatus;
  endReason: string | null;
  risk: RiskLevel;
  riskReasons: string[];
  model: string | null;
  summary: string[];
  events: EventView[];
  findings?: Finding[];
  fileChanges?: FileChange[];
  artifacts?: Artifact[];
  links?: SessionLinkView[];
  gaps?: CaptureGap[];
  domains?: DomainRecord[];
  unfinished?: UnfinishedItem[];
  sensitiveAccess?: SensitiveAccess[];
  subagents?: { id: string; type: string; lastMessage: string | null; eventCount: number }[];
  lastAssistantMessage?: string | null;
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  active: 'Active',
  finished: 'Finished',
  interrupted: 'Interrupted',
};

const RISK_LABEL: Record<RiskLevel, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Unknown',
};

export const STANDARD_LIMITS = [
  'Stillwatch sees what Claude Code hooks report and what changed on disk between snapshots.',
  'Network evidence is partial: programs started by the agent can reach the network without a recorded domain.',
  'Changes made and reverted between snapshots are only visible when a tool call recorded them.',
  'The agent reported section is the agent describing itself and is not evidence.',
];

function display(path: string, root: string | null): string {
  return root !== null && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function reportFinding(f: Finding): ReportFinding {
  return {
    id: f.id,
    ruleId: f.ruleId,
    severity: f.severity,
    title: f.title,
    reason: f.reason,
    requested: f.requested,
    evidence: { eventIds: f.evidence.eventIds, paths: f.evidence.paths },
  };
}

export function assemble(p: FixtureParts): MockSession {
  const first = p.events[0];
  const last = p.events[p.events.length - 1];
  if (!first || !last) throw new Error(`fixture ${p.id} has no events`);
  const findings = [...(p.findings ?? [])].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity),
  );
  const fileChanges = p.fileChanges ?? [];
  const artifacts = p.artifacts ?? [];
  const links = p.links ?? [];
  const gaps = p.gaps ?? [];
  const domains = p.domains ?? [];
  const unfinished = p.unfinished ?? [];
  const sensitiveAccess = p.sensitiveAccess ?? [];
  const subagents = p.subagents ?? [];
  const endedAt = p.status === 'active' ? null : last.ts;
  const durationMs = (endedAt ?? last.ts) - first.ts;
  const cwd = p.projectRoot;
  const count = (pred: (e: EventView) => boolean) => p.events.filter(pred).length;

  const record: SessionRecord = {
    id: p.id,
    agent: 'claude-code',
    projectId: p.projectRoot === null ? null : `proj-${p.projectName ?? 'x'}`,
    projectRoot: p.projectRoot,
    projectName: p.projectName,
    cwd,
    transcriptPath: `/Users/dev/.claude/projects/${p.id}.jsonl`,
    title: p.title,
    startedAt: first.ts,
    endedAt,
    lastEventAt: last.ts,
    status: p.status,
    endReason: p.endReason,
    risk: p.risk,
    riskReasons: p.riskReasons,
    model: p.model,
    permissionMode: 'default',
    summary: p.summary.join(' '),
    eventCount: p.events.length,
    findingCount: findings.length,
    fileChangeCount: fileChanges.length,
    subagentCount: subagents.length,
    analyzedAt: last.ts + 2000,
    analysisVersion: 1,
    chainHead: last.hash,
  };

  const agents: AgentRecord[] = [
    {
      sessionId: p.id,
      agentId: 'main',
      agentType: null,
      startedAt: first.ts,
      stoppedAt: endedAt,
      transcriptPath: record.transcriptPath,
      lastMessage: p.lastAssistantMessage ?? null,
      eventCount: count((e) => e.agentId === null),
    },
    ...subagents.map((s) => ({
      sessionId: p.id,
      agentId: s.id,
      agentType: s.type,
      startedAt: first.ts,
      stoppedAt: last.ts,
      transcriptPath: null,
      lastMessage: s.lastMessage,
      eventCount: s.eventCount,
    })),
  ];

  const detail: SessionDetailResponse = {
    session: record,
    agents,
    findings,
    fileChanges,
    artifacts,
    links,
    gaps,
    domains,
    unfinished,
    sensitiveAccess,
    stats: {
      toolCalls: count((e) => e.kind === 'tool.pre'),
      byCategory: {},
      filesRead: count((e) => e.kind === 'tool.post' && e.tool?.category === 'file.read'),
      filesWritten: fileChanges.length,
      commands: count((e) => e.kind === 'tool.pre' && e.tool?.category === 'shell'),
      failures: count((e) => e.kind === 'tool.failure'),
      prompts: count((e) => e.kind === 'prompt.submit'),
      turns: count((e) => e.kind === 'turn.stop'),
      subagents: subagents.length,
      permissionRequests: count((e) => e.kind === 'permission.request'),
      denials: count((e) => e.kind === 'permission.denied'),
      durationMs,
    },
    lastAssistantMessage: p.lastAssistantMessage ?? null,
    report: {
      v: REPORT_VERSION,
      generatedAt: last.ts + 2000,
      sessionId: p.id,
      title: p.title ?? 'Untitled session',
      agentLabel:
        subagents.length === 0
          ? 'Claude Code'
          : `Claude Code, with ${subagents.length} subagent${subagents.length === 1 ? '' : 's'}`,
      project: p.projectName,
      status: p.status,
      statusLabel: STATUS_LABEL[p.status],
      risk: p.risk,
      riskLabel: RISK_LABEL[p.risk],
      startedAt: first.ts,
      endedAt,
      durationMs,
      model: p.model,
      summary: p.summary,
      whyRisk: findings.filter((f) => f.severity !== 'low').map(reportFinding),
      otherFindings: findings.filter((f) => f.severity === 'low').map(reportFinding),
      filesChanged: fileChanges.map((c) => ({
        path: c.path,
        display: c.relPath ?? display(c.path, cwd),
        change: c.change,
        additions: c.additions,
        deletions: c.deletions,
        attribution: c.attribution,
        classes: c.classes,
      })),
      sensitiveAccess: sensitiveAccess.map((s) => ({
        path: s.path,
        display: display(s.path, cwd),
        op: s.op,
        eventId: s.eventId,
      })),
      network: domains.map((d) => ({
        domain: d.domain,
        isNew: d.isNew,
        count: d.count,
        via: d.via,
      })),
      networkNote:
        'Network evidence is partial. Stillwatch records domains named in tool calls and commands, not traffic from programs the agent started.',
      whatRemains: artifacts.map((a) => ({
        kind: a.kind,
        path: a.path,
        display: display(a.path, cwd),
        change: a.change,
        detail: a.detail,
        eventIds: a.eventIds,
      })),
      unfinished,
      related: links.map((l) => ({
        direction: l.direction,
        sessionId: l.direction === 'outgoing' ? l.targetSessionId : l.sourceSessionId,
        sessionTitle: l.otherSessionTitle,
        path: l.path,
        display: display(l.path, cwd),
        kind: l.kind,
      })),
      gaps: gaps.map((g) => ({ severity: g.severity, reason: g.reason })),
      agentReported: p.lastAssistantMessage ?? null,
      subagents: subagents.map((s) => ({ id: s.id, type: s.type })),
      limits: STANDARD_LIMITS,
    },
  };

  const summary: SessionSummary = {
    id: p.id,
    agent: 'claude-code',
    title: p.title,
    projectId: record.projectId,
    projectName: p.projectName,
    projectRoot: p.projectRoot,
    startedAt: record.startedAt,
    endedAt,
    lastEventAt: record.lastEventAt,
    status: p.status,
    risk: p.risk,
    riskReasons: p.riskReasons,
    summary: record.summary,
    eventCount: record.eventCount,
    findingCount: record.findingCount,
    fileChangeCount: record.fileChangeCount,
    subagentCount: record.subagentCount,
    topFindings: findings.slice(0, 3).map((f) => ({ severity: f.severity, title: f.title })),
    gapCount: gaps.length,
  };

  return { summary, detail, events: p.events };
}

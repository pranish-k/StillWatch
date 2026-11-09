/**
 * Builds the `SessionReport` model from a `SessionDetail`. Text fields in the
 * model are sanitized (escape sequences and controls removed, invisible
 * characters made visible) and capped; `path` and `domain` fields keep their
 * original value for identity, with sanitized `display` fields next to them.
 */
import {
  ARTIFACT_KINDS,
  MAIN_AGENT_ID,
  REPORT_VERSION,
  displayPath,
  pathKey,
} from '@stillwatch/schema';
import type {
  Finding,
  ReportFinding,
  ReportRelated,
  ReportRemains,
  SessionDetail,
  SessionReport,
} from '@stillwatch/schema';
import { compareStrings } from './format';
import { agentName, artifactIsFile, gapSeverityRank, riskLabel, statusLabel } from './labels';
import {
  activitySentence,
  compareFindings,
  endingSentence,
  findingsSentence,
  gapSentence,
} from './summary';
import { cleanLine, clip, multiLine } from './text';
import type { ReportOptions } from './types';

/** Standing statement of what a Phase 1 report cannot see. */
export const REPORT_LIMITS: readonly string[] = Object.freeze([
  'Network evidence is partial: only domains named in tool calls and commands are listed, not the traffic itself.',
  'Stillwatch sees tool calls and the files they changed, not everything a script or program did internally.',
  'Activity before install, while hooks were off, or while Stillwatch was not running to take snapshots may be missing; capture gaps list what is known to be missing.',
  'Only Claude Code sessions are recorded in Phase 1; other agents and tools on this computer are not.',
]);

/** Always shown with the network list. */
export const NETWORK_NOTE =
  'Partial evidence: only domains named in tool calls and commands are listed. This is not a network log.';

const LIMIT = {
  title: 200,
  findingTitle: 200,
  reason: 1_000,
  display: 500,
  detail: 500,
  label: 300,
  gap: 600,
  name: 200,
  message: 8_192,
} as const;

function toReportFinding(finding: Finding): ReportFinding {
  return {
    id: finding.id,
    ruleId: finding.ruleId,
    severity: finding.severity,
    title: cleanLine(finding.title, LIMIT.findingTitle) || 'Untitled finding',
    reason: cleanLine(finding.reason, LIMIT.reason),
    requested: finding.requested,
    evidence: {
      eventIds: [...finding.evidence.eventIds],
      paths: [...finding.evidence.paths],
    },
  };
}

function durationOf(startedAt: number, endedAt: number | null, lastEventAt: number): number | null {
  const end = endedAt ?? lastEventAt;
  if (!Number.isFinite(startedAt) || !Number.isFinite(end) || end < startedAt) return null;
  return end - startedAt;
}

/** Builds the report model. Pure: time comes only from `options.now` or the session itself. */
export function buildSessionReport(
  detail: SessionDetail,
  options: ReportOptions = {},
): SessionReport {
  const { session } = detail;
  const home = options.home ?? null;
  const base = session.projectRoot;
  const show = (path: string): string => cleanLine(displayPath(path, base, home), LIMIT.display);

  const subagents = detail.agents
    .filter((agent) => agent.agentId !== MAIN_AGENT_ID)
    .sort(
      (a, b) =>
        (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER) ||
        compareStrings(a.agentId, b.agentId),
    )
    .map((agent) => ({
      id: agent.agentId,
      type: agent.agentType === null ? null : cleanLine(agent.agentType, 100) || null,
    }));
  const subagentCount = Math.max(subagents.length, session.subagentCount);
  const agentLabel =
    subagentCount > 0
      ? `${agentName(session.agent)}, with ${String(subagentCount)} ${subagentCount === 1 ? 'subagent' : 'subagents'}`
      : agentName(session.agent);

  const sortedFindings = [...detail.findings].sort(compareFindings);
  const notable = sortedFindings.filter((f) => f.severity !== 'low');
  const low = sortedFindings.filter((f) => f.severity === 'low');

  const filesChanged = detail.fileChanges
    .map((change) => ({
      path: change.path,
      display: show(change.path),
      change: change.change,
      additions: change.additions,
      deletions: change.deletions,
      attribution: change.attribution,
      classes: [...change.classes],
    }))
    .sort((a, b) => compareStrings(a.display, b.display) || compareStrings(a.path, b.path));

  const seenAccess = new Set<string>();
  const sensitiveAccess = [...detail.sensitiveAccess]
    .sort(
      (a, b) =>
        a.ts - b.ts || compareStrings(a.path, b.path) || compareStrings(a.eventId, b.eventId),
    )
    .filter((access) => {
      const key = `${pathKey(access.path)}\u0000${access.op}`;
      if (seenAccess.has(key)) return false;
      seenAccess.add(key);
      return true;
    })
    .map((access) => ({
      path: access.path,
      display: show(access.path),
      op: access.op,
      eventId: access.eventId,
    }));

  const network = detail.domains
    .map((domain) => ({
      domain: domain.domain,
      isNew: domain.isNew,
      count: domain.count,
      via: [...new Set(domain.via.map((v) => cleanLine(v, 80)).filter((v) => v !== ''))].sort(
        compareStrings,
      ),
    }))
    .sort((a, b) => Number(b.isNew) - Number(a.isNew) || compareStrings(a.domain, b.domain));

  const kindOrder = (kind: (typeof ARTIFACT_KINDS)[number]): number => ARTIFACT_KINDS.indexOf(kind);
  const whatRemains: ReportRemains[] = detail.artifacts
    .map((artifact) => ({
      kind: artifact.kind,
      path: artifact.path,
      display:
        artifactIsFile(artifact.kind) && artifact.path.startsWith('/')
          ? show(artifact.path)
          : cleanLine(artifact.path, LIMIT.display),
      change: artifact.change,
      detail: artifact.detail === null ? null : cleanLine(artifact.detail, LIMIT.detail) || null,
      eventIds: [...artifact.eventIds],
    }))
    .sort(
      (a, b) =>
        kindOrder(a.kind) - kindOrder(b.kind) ||
        compareStrings(a.display, b.display) ||
        compareStrings(a.change, b.change),
    );

  const unfinished = detail.unfinished.map((item) => ({
    kind: item.kind,
    label: cleanLine(item.label, LIMIT.label),
    eventId: item.eventId,
  }));

  const seenLinks = new Set<string>();
  const related: ReportRelated[] = [...detail.links]
    .sort(
      (a, b) =>
        Number(a.direction === 'outgoing') - Number(b.direction === 'outgoing') ||
        a.at - b.at ||
        compareStrings(a.path, b.path),
    )
    .map((link) => ({
      direction: link.direction,
      sessionId: link.direction === 'incoming' ? link.sourceSessionId : link.targetSessionId,
      sessionTitle:
        link.otherSessionTitle === null
          ? null
          : cleanLine(link.otherSessionTitle, LIMIT.name) || null,
      path: link.path,
      display: show(link.path),
      kind: link.kind,
    }))
    .filter((link) => {
      const key = `${link.direction}\u0000${link.sessionId}\u0000${pathKey(link.path)}\u0000${link.kind}`;
      if (seenLinks.has(key)) return false;
      seenLinks.add(key);
      return true;
    });

  const seenGaps = new Set<string>();
  const gaps = [...detail.gaps]
    .sort(
      (a, b) =>
        gapSeverityRank(b.severity) - gapSeverityRank(a.severity) ||
        a.createdAt - b.createdAt ||
        compareStrings(a.reason, b.reason),
    )
    .map((gap) => ({ severity: gap.severity, reason: cleanLine(gap.reason, LIMIT.gap) }))
    .filter((gap) => {
      const key = `${gap.severity}\u0000${gap.reason}`;
      if (gap.reason === '' || seenGaps.has(key)) return false;
      seenGaps.add(key);
      return true;
    });

  const summary = [
    // Only changes this session's tools or commands explain count as the agent's.
    activitySentence(detail.stats, filesChanged.filter(byAgent).length, subagentCount),
    endingSentence(session, session.status, unfinished),
    findingsSentence(notable, low),
  ];
  const gapNote = gapSentence(session.risk, gaps);
  if (gapNote !== null) summary.push(gapNote);

  const message =
    detail.lastAssistantMessage === null
      ? ''
      : clip(multiLine(detail.lastAssistantMessage), LIMIT.message);

  return {
    v: REPORT_VERSION,
    generatedAt: options.now ?? session.analyzedAt ?? session.lastEventAt,
    sessionId: session.id,
    title:
      (session.title === null ? '' : cleanLine(session.title, LIMIT.title)) || 'Untitled session',
    agentLabel,
    project:
      session.projectName !== null && cleanLine(session.projectName, LIMIT.name) !== ''
        ? cleanLine(session.projectName, LIMIT.name)
        : session.projectRoot === null
          ? null
          : cleanLine(displayPath(session.projectRoot, null, home), LIMIT.name),
    status: session.status,
    statusLabel: statusLabel(session.status),
    risk: session.risk,
    riskLabel: riskLabel(session.risk),
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMs: durationOf(session.startedAt, session.endedAt, session.lastEventAt),
    model: session.model === null ? null : cleanLine(session.model, 100) || null,
    summary,
    whyRisk: notable.map(toReportFinding),
    otherFindings: low.map(toReportFinding),
    filesChanged,
    sensitiveAccess,
    network,
    networkNote: NETWORK_NOTE,
    whatRemains,
    unfinished,
    related,
    gaps,
    agentReported: message === '' ? null : message,
    subagents,
    limits: [...REPORT_LIMITS],
  };
}

function byAgent(change: { attribution: string }): boolean {
  return change.attribution === 'tool' || change.attribution === 'shell';
}

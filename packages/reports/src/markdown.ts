/**
 * Renders a `SessionReport` as Markdown, in the layout of the sample report
 * in the detailed spec. Every value from the report passes through
 * `mdText`, `mdCode`, or `mdFence`; only fixed labels are written raw.
 */
import type { ReportFinding, SessionReport } from '@stillwatch/schema';
import {
  countOf,
  formatCount,
  formatDuration,
  formatTimestamp,
  joinList,
  plural,
  shortId,
} from './format';
import {
  accessOpLabel,
  artifactChangeLabel,
  artifactKindLabel,
  attributionNote,
  fileChangeLabel,
  gapSeverityLabel,
  linkVerb,
  pathClassLabel,
  severityLabel,
  unfinishedKindLabel,
} from './labels';
import { mdCode, mdFence, mdText } from './markdown-escape';
import { cleanLine, stripTrailingPeriod } from './text';

const CAP = {
  findings: 100,
  files: 200,
  access: 100,
  network: 100,
  remains: 100,
  unfinished: 50,
  related: 50,
  gaps: 50,
  evidencePaths: 5,
  subagentTypes: 5,
} as const;

/** Renders up to `max` items, then an "and N more" line. */
function capped<T>(
  items: readonly T[],
  max: number,
  noun: string,
  render: (item: T) => string[],
): string[] {
  const lines = items.slice(0, max).flatMap(render);
  const rest = items.length - max;
  if (rest > 0) lines.push(`- and ${formatCount(rest)} more ${plural(rest, noun)}`);
  return lines;
}

function riskHeading(report: SessionReport): string {
  switch (report.risk) {
    case 'high':
      return 'Why this is high risk';
    case 'medium':
      return 'Why this is medium risk';
    case 'low':
    case 'unknown':
      return 'Why this needs a look';
  }
}

function findingLines(finding: ReportFinding, displays: ReadonlyMap<string, string>): string[] {
  const requested =
    finding.requested === true
      ? ' (requested)'
      : finding.requested === false
        ? ' (not requested)'
        : '';
  const title = stripTrailingPeriod(cleanLine(finding.title, 200)) || 'Untitled finding';
  let line = `- ${severityLabel(finding.severity)}: ${mdText(title)}${requested}.`;
  const reason = cleanLine(finding.reason, 1_000);
  if (reason !== '') line += ` ${mdText(reason, 1_000)}`;
  const lines = [line];

  const { paths, eventIds } = finding.evidence;
  const evidence: string[] = [];
  if (paths.length > 0) {
    const shown = paths.slice(0, CAP.evidencePaths).map((p) => mdCode(displays.get(p) ?? p));
    if (paths.length > CAP.evidencePaths)
      shown.push(`${String(paths.length - CAP.evidencePaths)} more`);
    evidence.push(joinList(shown));
  }
  if (eventIds.length > 0) evidence.push(countOf(eventIds.length, 'event'));
  if (evidence.length > 0) lines.push(`  Evidence: ${evidence.join('; ')}.`);
  return lines;
}

function headerLines(report: SessionReport): string[] {
  const types = [...new Set(report.subagents.flatMap((s) => (s.type === null ? [] : [s.type])))];
  let agent = mdText(report.agentLabel);
  if (types.length > 0) {
    const shown = types.slice(0, CAP.subagentTypes).map((t) => mdText(t, 100));
    if (types.length > CAP.subagentTypes)
      shown.push(`${String(types.length - CAP.subagentTypes)} more`);
    agent += ` (${shown.join(', ')})`;
  }
  const risk =
    report.risk === 'unknown'
      ? `${report.riskLabel} (important data is missing; see Capture gaps)`
      : report.riskLabel;
  const lines = [`- Agent: ${agent}`, `- Status: ${report.statusLabel}`, `- Risk: ${risk}`];
  if (report.project !== null) lines.push(`- Project: ${mdCode(report.project)}`);
  lines.push(`- Started: ${formatTimestamp(report.startedAt)}`);
  if (report.endedAt !== null) lines.push(`- Ended: ${formatTimestamp(report.endedAt)}`);
  if (report.durationMs !== null) lines.push(`- Duration: ${formatDuration(report.durationMs)}`);
  if (report.model !== null) lines.push(`- Model: ${mdCode(report.model)}`);
  lines.push(`- Session ID: ${mdCode(report.sessionId)}`);
  return lines;
}

function sessionRef(id: string, title: string | null): string {
  const name = title === null || title === '' ? '' : ` (${mdText(title, 80)})`;
  return `session ${mdCode(shortId(id))}${name}`;
}

/** Renders the report as Markdown, in the layout of the sample in the detailed spec. */
export function renderMarkdownReport(report: SessionReport): string {
  const out: string[] = [];
  const section = (heading: string, body: string[]): void => {
    if (body.length > 0) out.push('', `## ${heading}`, '', ...body);
  };

  const displays = new Map<string, string>();
  for (const f of report.filesChanged) displays.set(f.path, f.display);
  for (const r of report.whatRemains) displays.set(r.path, r.display);
  for (const a of report.sensitiveAccess) displays.set(a.path, a.display);

  out.push(
    `# Session: ${mdText(report.title, 200) || 'Untitled session'}`,
    '',
    ...headerLines(report),
  );
  section(
    'Summary',
    report.summary.map((sentence) => mdText(sentence, 600)),
  );

  section(
    riskHeading(report),
    capped(report.whyRisk, CAP.findings, 'finding', (f) => findingLines(f, displays)),
  );
  section(
    report.whyRisk.length > 0 ? 'Other findings' : 'Findings',
    capped(report.otherFindings, CAP.findings, 'finding', (f) => findingLines(f, displays)),
  );
  if (report.whyRisk.length === 0 && report.otherFindings.length === 0) {
    section('Findings', ['Nothing notable: no rule flagged this session.']);
  }

  section(
    'Files changed',
    capped(report.filesChanged, CAP.files, 'file', (file) => {
      const parts = [fileChangeLabel(file.change)];
      if (file.additions !== null || file.deletions !== null) {
        parts.push(`+${String(file.additions ?? 0)} -${String(file.deletions ?? 0)}`);
      }
      for (const cls of file.classes) parts.push(pathClassLabel(cls));
      const note = attributionNote(file.attribution);
      if (note !== null) parts.push(note);
      return [`- ${mdCode(file.display)} (${parts.join(', ')})`];
    }),
  );

  section(
    'Sensitive access',
    capped(report.sensitiveAccess, CAP.access, 'path', (access) => [
      `- ${accessOpLabel(cleanLine(access.op, 20))} ${mdCode(access.display)}`,
    ]),
  );

  if (report.network.length > 0) {
    section('Network', [
      ...capped(report.network, CAP.network, 'domain', (domain) => {
        const details: string[] = [];
        if (domain.isNew) details.push('new');
        if (domain.via.length > 0)
          details.push(`via ${joinList(domain.via.map((v) => mdText(v, 80)))}`);
        return [
          `- ${mdCode(domain.domain)}${details.length > 0 ? ` (${details.join(', ')})` : ''}`,
        ];
      }),
      '',
      mdText(report.networkNote, 400),
    ]);
  }

  section(
    'What remains',
    capped(report.whatRemains, CAP.remains, 'item', (item) => {
      const detail = item.detail === null ? '' : `: ${mdText(item.detail, 500)}`;
      return [
        `- ${mdCode(item.display)} (${artifactKindLabel(item.kind)}, ${artifactChangeLabel(item.change)})${detail}`,
      ];
    }),
  );

  section(
    'Unfinished work',
    capped(report.unfinished, CAP.unfinished, 'item', (item) => [
      `- ${unfinishedKindLabel(item.kind)}: ${mdText(item.label) || 'unnamed'}`,
    ]),
  );

  section(
    'Related sessions',
    capped(report.related, CAP.related, 'link', (link) => {
      const verb = linkVerb(link.kind);
      const ref = sessionRef(link.sessionId, link.sessionTitle);
      return link.direction === 'outgoing'
        ? [`- ${ref.charAt(0).toUpperCase()}${ref.slice(1)} ${verb} ${mdCode(link.display)}`]
        : [`- This session ${verb} ${mdCode(link.display)}, written by ${ref}`];
    }),
  );

  section(
    'Capture gaps',
    capped(report.gaps, CAP.gaps, 'gap', (gap) => [
      `- ${gapSeverityLabel(gap.severity)}: ${mdText(gap.reason, 600)}`,
    ]),
  );

  if (report.agentReported !== null) {
    section('What the agent reported', [
      "The agent's own final message, shown as a claim rather than evidence.",
      '',
      mdFence(report.agentReported),
    ]);
  }

  section(
    'Limits',
    report.limits.map((limit) => `- ${mdText(limit, 600)}`),
  );

  out.push('', `Generated by Stillwatch on ${formatTimestamp(report.generatedAt)}.`);
  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

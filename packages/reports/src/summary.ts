/**
 * Deterministic plain-English summaries. Phase 1 has no AI: every sentence
 * is built from counts, statuses, and finding titles.
 */
import { severityRank } from '@stillwatch/schema';
import type {
  CaptureGap,
  Finding,
  RiskLevel,
  SessionRecord,
  SessionStats,
  SessionStatus,
  UnfinishedItem,
} from '@stillwatch/schema';
import { compareStrings, countOf, joinList } from './format';
import { cleanLine, stripTrailingPeriod } from './text';
import type { SummaryInput } from './types';

/** Findings ordered for review: highest severity first, then earliest, then id. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    severityRank(b.severity) - severityRank(a.severity) || a.ts - b.ts || compareStrings(a.id, b.id)
  );
}

function titleOf(finding: Pick<Finding, 'title'>, max: number): string {
  return stripTrailingPeriod(cleanLine(finding.title, max)) || 'Untitled finding';
}

function webRequests(stats: SessionStats): number {
  return (stats.byCategory['web.fetch'] ?? 0) + (stats.byCategory['web.search'] ?? 0);
}

/** "The agent changed 3 files, ran 7 commands, and read 12 files, with help from 2 subagents." */
export function activitySentence(
  stats: SessionStats | null,
  filesChanged: number,
  subagents: number,
): string {
  const parts: string[] = [];
  if (filesChanged > 0) parts.push(`changed ${countOf(filesChanged, 'file')}`);
  else if (stats && stats.filesWritten > 0)
    parts.push(`wrote ${countOf(stats.filesWritten, 'file')}`);
  if (stats) {
    if (stats.commands > 0) parts.push(`ran ${countOf(stats.commands, 'command')}`);
    if (stats.filesRead > 0) parts.push(`read ${countOf(stats.filesRead, 'file')}`);
    const web = webRequests(stats);
    if (web > 0) parts.push(`made ${countOf(web, 'web request')}`);
  }
  const helpers = subagents > 0 ? `, with help from ${countOf(subagents, 'subagent')}` : '';
  if (parts.length === 0) {
    if (stats === null) return 'Stillwatch has no activity details for this session yet.';
    if (stats.toolCalls > 0) {
      return `The agent made ${countOf(stats.toolCalls, 'tool call')} without changing files or running commands${helpers}.`;
    }
    return 'The agent did not use any tools.';
  }
  return `The agent ${joinList(parts)}${helpers}.`;
}

/** How the session ended, including what was left unfinished. */
export function endingSentence(
  session: Pick<SessionRecord, 'endReason'>,
  status: SessionStatus,
  unfinished: readonly UnfinishedItem[],
): string {
  const tasks = unfinished.filter((item) => item.kind === 'task');
  switch (status) {
    case 'finished':
      if (session.endReason === 'no_session_end') {
        return 'The session went quiet without a recorded end, so Stillwatch closed it.';
      }
      if (tasks.length > 0)
        return `The session finished with ${countOf(tasks.length, 'task')} still open.`;
      return 'The session finished.';
    case 'interrupted': {
      const [only] = unfinished;
      if (only === undefined) return 'It stopped before its last turn finished.';
      if (unfinished.length === 1 && only.kind === 'task') {
        const label = stripTrailingPeriod(cleanLine(only.label, 80));
        if (label !== '') return `It stopped before finishing "${label}".`;
      }
      return `It stopped mid-task and left ${countOf(unfinished.length, 'item')} unfinished.`;
    }
    case 'active':
      return 'The session is still active.';
  }
}

/** The most important findings in one sentence. */
export function findingsSentence(notable: readonly Finding[], low: readonly Finding[]): string {
  const [first, second] = notable;
  if (first === undefined) {
    if (low.length === 0) return 'No rule flagged anything in this session.';
    return `Stillwatch noted ${countOf(low.length, 'low-severity item')} and nothing more serious.`;
  }
  // Name the low-severity count too, so the sentence matches the session's finding total.
  const plus = low.length > 0 ? `, plus ${countOf(low.length, 'low-severity item')}` : '';
  if (second === undefined) return `Stillwatch flagged one finding: ${titleOf(first, 100)}${plus}.`;
  const two = `${titleOf(first, 80)}; ${titleOf(second, 80)}`;
  if (notable.length === 2) return `Stillwatch flagged two findings: ${two}${plus}.`;
  return `Stillwatch flagged ${countOf(notable.length, 'finding')}, including ${two}${plus}.`;
}

/** A sentence about missing data, or null when nothing important is missing. */
export function gapSentence(
  risk: RiskLevel,
  gaps: readonly Pick<CaptureGap, 'severity'>[],
): string | null {
  if (risk === 'unknown') return 'Important data is missing, so the risk level is unknown.';
  if (gaps.some((gap) => gap.severity !== 'info'))
    return 'Some data may be missing; see the capture gaps.';
  return null;
}

const LIST_SUMMARY_MAX = 240;

/** One to three short sentences for the session list. Deterministic, at most 240 characters. */
export function summarizeSession(input: SummaryInput): string {
  const sentences: string[] = [];
  const changed = input.fileChanges.filter(
    (f) => f.attribution === 'tool' || f.attribution === 'shell',
  ).length;
  const commands = input.stats?.commands ?? 0;
  const reads = input.stats?.filesRead ?? 0;
  const activity: string[] = [];
  if (changed > 0) activity.push(`changed ${countOf(changed, 'file')}`);
  if (commands > 0) activity.push(`ran ${countOf(commands, 'command')}`);
  if (activity.length === 0 && reads > 0) activity.push(`read ${countOf(reads, 'file')}`);
  const sentence = joinList(activity);
  sentences.push(
    sentence === ''
      ? 'No file changes or commands.'
      : `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`,
  );

  const notable = input.findings.filter((f) => f.severity !== 'low').sort(compareFindings);
  const [first, second] = notable;
  if (first !== undefined) {
    if (second === undefined) sentences.push(`Flagged: ${titleOf(first, 90)}.`);
    else if (notable.length === 2)
      sentences.push(`Flagged: ${titleOf(first, 60)}; ${titleOf(second, 60)}.`);
    else
      sentences.push(
        `Flagged ${countOf(notable.length, 'finding')}, including ${titleOf(first, 80)}.`,
      );
  }

  if (input.status === 'interrupted') {
    sentences.push(
      input.unfinished.length > 0
        ? `Interrupted with ${countOf(input.unfinished.length, 'unfinished item')}.`
        : 'Interrupted mid-task.',
    );
  } else if (input.session.risk === 'unknown') {
    sentences.push('Some data is missing.');
  }

  let out = sentences.join(' ');
  while (out.length > LIST_SUMMARY_MAX && sentences.length > 1) {
    sentences.pop();
    out = sentences.join(' ');
  }
  return cleanLine(out, LIST_SUMMARY_MAX);
}

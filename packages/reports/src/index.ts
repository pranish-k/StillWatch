/**
 * @stillwatch/reports
 *
 * Builds the session report model and renders it as Markdown. The dashboard
 * renders the same `SessionReport`, so both always match (deliverable D6).
 * Phase 1 summaries are deterministic sentences built from facts and
 * findings; there is no AI.
 *
 * Markdown output is untrusted-data-safe: file names, commands, and titles
 * are escaped so they cannot inject links, HTML, or headings into a viewer.
 *
 * Public API contract. Signatures are fixed; implementations replace the stubs.
 */
import type {
  Artifact,
  FileChange,
  Finding,
  NormalizedEvent,
  SessionDetail,
  SessionRecord,
  SessionReport,
  SessionStats,
  SessionStatus,
  UnfinishedItem,
} from '@stillwatch/schema';

/** Standing statement of what a Phase 1 report cannot see. */
export const REPORT_LIMITS: readonly string[] = [];

export type ReportOptions = {
  now?: number;
  /** The user's home directory, to display paths with `~`. */
  home?: string | null;
};

export function buildSessionReport(
  _detail: SessionDetail,
  _options?: ReportOptions,
): SessionReport {
  throw new Error('not implemented: buildSessionReport');
}

/** Renders the report as Markdown, in the layout of the sample in the detailed spec. */
export function renderMarkdownReport(_report: SessionReport): string {
  throw new Error('not implemented: renderMarkdownReport');
}

export type SummaryInput = {
  session: SessionRecord;
  status: SessionStatus;
  stats: SessionStats | null;
  findings: Finding[];
  fileChanges: FileChange[];
  artifacts: Artifact[];
  unfinished: UnfinishedItem[];
};

/** One to three plain sentences for the session list, e.g. "Changed 5 files and ran 12 commands. A git hook was added." */
export function summarizeSession(_input: SummaryInput): string {
  throw new Error('not implemented: summarizeSession');
}

export type DescribeOptions = { base?: string | null; home?: string | null };

/** One-line description of an event for timelines, e.g. "Ran git status --short" or "Edited src/auth.ts". */
export function describeEvent(_event: NormalizedEvent, _options?: DescribeOptions): string {
  throw new Error('not implemented: describeEvent');
}

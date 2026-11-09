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
 */
export type { DescribeOptions, ReportOptions, SummaryInput } from './types';
export { REPORT_LIMITS, NETWORK_NOTE, buildSessionReport } from './report';
export { renderMarkdownReport } from './markdown';
export { summarizeSession } from './summary';
export { describeEvent } from './describe';
export { mdCode, mdFence, mdText } from './markdown-escape';
export { cleanLine, oneLine, multiLine } from './text';
export { formatDuration, formatTimestamp } from './format';

/** A simple Markdown rendering of a SessionReport, for the mock report.md route. */
import type { SessionReport } from '@stillwatch/schema';

export function reportMarkdown(r: SessionReport): string {
  const lines: string[] = [
    `# Session: ${r.title}`,
    '',
    `- Agent: ${r.agentLabel}`,
    `- Status: ${r.statusLabel}`,
    `- Risk: ${r.riskLabel}`,
    '',
    '## Summary',
    '',
    ...r.summary,
    '',
  ];
  if (r.whyRisk.length > 0) {
    lines.push(`## Why this is ${r.riskLabel.toLowerCase()} risk`, '');
    for (const f of r.whyRisk) lines.push(`- ${f.title}: ${f.reason}`);
    lines.push('');
  }
  lines.push('## Files changed', '');
  for (const f of r.filesChanged) lines.push(`- ${f.display} (${f.change})`);
  lines.push('', '## What remains', '');
  for (const a of r.whatRemains) lines.push(`- ${a.display}${a.detail ? `, ${a.detail}` : ''}`);
  lines.push('');
  return lines.join('\n');
}

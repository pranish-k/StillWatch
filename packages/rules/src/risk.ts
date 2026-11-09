/** Session risk from findings and capture gaps (ADR-011). */
import { maxSeverity, type CaptureGap, type Finding, type RiskLevel } from '@stillwatch/schema';
import { compareFindings } from './findings';

/** See `computeRisk` in index.ts for the contract. */
export function riskOf(
  findings: readonly Finding[],
  gaps: readonly CaptureGap[],
): { risk: RiskLevel; reasons: string[] } {
  const top = maxSeverity(findings.map((f) => f.severity));
  const critical = gaps.filter((g) => g.severity === 'critical');
  const risk: RiskLevel =
    top === 'high' || top === 'medium' ? top : critical.length > 0 ? 'unknown' : 'low';
  const reasons: string[] = [];
  if (risk === 'unknown')
    for (const g of critical) if (!reasons.includes(g.reason)) reasons.push(g.reason);
  for (const f of [...findings].sort(compareFindings)) {
    if (!reasons.includes(f.title)) reasons.push(f.title);
  }
  return { risk, reasons };
}

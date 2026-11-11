/**
 * Findings are alerts produced by fixed rules (ADR-010). Every finding links
 * to the events, paths, or artifacts behind it. Risk levels come from the
 * highest finding severity (ADR-011), never from a numeric score.
 */

export const SEVERITIES = ['low', 'medium', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high', 'unknown'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RULE_IDS = [
  'secret.read',
  'secret.exfiltration',
  'persistence.git_hook',
  'persistence.git_config',
  'persistence.ci',
  'persistence.task_runner',
  'persistence.scheduled_task',
  'persistence.startup_file',
  'agent.config_changed',
  'memory.note_written',
  'memory.note_loaded',
  'session.interrupted_with_changes',
  'safety.bypass',
  'safety.destructive',
  'package.new',
  'prompt_injection.possible',
  'evidence.unattributed_change',
  'network.new_domain',
  'monitor.tampering',
  'background.left_running',
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export type RuleCategory =
  'secrets' | 'persistence' | 'memory' | 'behavior' | 'network' | 'evidence';

export type RuleDefinition = {
  id: RuleId;
  title: string;
  /** One or two sentences: what the rule checks and why it matters. */
  description: string;
  defaultSeverity: Severity;
  category: RuleCategory;
};

export type Evidence = {
  eventIds: string[];
  paths: string[];
  artifactIds: string[];
  /** Optional extra explanation, for example "matched by the start and end snapshots". */
  note: string | null;
};

export type Finding = {
  /** Deterministic: the same rule and subject in the same session keep the same id across re-analysis. */
  id: string;
  sessionId: string;
  ruleId: RuleId;
  severity: Severity;
  /** Short title, e.g. "Git hook added". */
  title: string;
  /** Plain-English explanation of why this was flagged. */
  reason: string;
  /** What the finding is about, e.g. a path or a domain. Used to deduplicate. */
  subject: string;
  evidence: Evidence;
  /**
   * Phase 1 scope check: `true` when the user's own prompts mention this kind
   * of change, `false` when they do not, `null` when it does not apply.
   */
  requested: boolean | null;
  /** Time of the earliest evidence, epoch milliseconds. */
  ts: number;
};

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };
const RISK_RANK: Record<RiskLevel, number> = { low: 1, unknown: 2, medium: 3, high: 4 };

export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}

/** Ranking used for the review queue: high, medium, unknown, low. */
export function riskRank(level: RiskLevel): number {
  return RISK_RANK[level];
}

export function maxSeverity(severities: Iterable<Severity>): Severity | null {
  let best: Severity | null = null;
  for (const s of severities) {
    if (best === null || SEVERITY_RANK[s] > SEVERITY_RANK[best]) best = s;
  }
  return best;
}

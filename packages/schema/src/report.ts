/**
 * The session report model. The dashboard and the Markdown export both
 * render this one structure, so they always match (deliverable D6).
 */
import type { PathClass } from './facts';
import type { RiskLevel, RuleId, Severity } from './findings';
import type {
  Artifact,
  ArtifactKind,
  Attribution,
  CaptureGap,
  FileChangeKind,
  SessionLink,
  SessionStatus,
  UnfinishedItem,
} from './session';

export type ReportFinding = {
  id: string;
  ruleId: RuleId;
  severity: Severity;
  title: string;
  reason: string;
  requested: boolean | null;
  evidence: { eventIds: string[]; paths: string[] };
};

export type ReportFileChange = {
  path: string;
  /** Path for display: relative to the project root when inside it. */
  display: string;
  change: FileChangeKind;
  additions: number | null;
  deletions: number | null;
  attribution: Attribution;
  classes: PathClass[];
};

export type ReportRemains = {
  kind: ArtifactKind;
  path: string;
  display: string;
  change: Artifact['change'];
  detail: string | null;
  eventIds: string[];
};

export type ReportRelated = {
  direction: 'incoming' | 'outgoing';
  sessionId: string;
  sessionTitle: string | null;
  path: string;
  display: string;
  kind: SessionLink['kind'];
};

export type SessionReport = {
  v: number;
  generatedAt: number;
  sessionId: string;
  title: string;
  /** e.g. "Claude Code, with 2 subagents". */
  agentLabel: string;
  project: string | null;
  status: SessionStatus;
  statusLabel: string;
  risk: RiskLevel;
  riskLabel: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  model: string | null;
  /** Plain-English summary sentences, built from facts and findings only (no AI in Phase 1). */
  summary: string[];
  /** High and medium findings, highest severity first. */
  whyRisk: ReportFinding[];
  /** Low findings. */
  otherFindings: ReportFinding[];
  filesChanged: ReportFileChange[];
  sensitiveAccess: { path: string; display: string; op: string; eventId: string }[];
  network: { domain: string; isNew: boolean; count: number; via: string[] }[];
  /** Always explains that network evidence is partial. */
  networkNote: string;
  whatRemains: ReportRemains[];
  unfinished: UnfinishedItem[];
  related: ReportRelated[];
  gaps: { severity: CaptureGap['severity']; reason: string }[];
  /** The agent's own final message. Shown as a claim, never as evidence. */
  agentReported: string | null;
  subagents: { id: string; type: string | null }[];
  /** Standing statement of what the report cannot see. */
  limits: string[];
};

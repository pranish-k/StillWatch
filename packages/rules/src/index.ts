/**
 * @stillwatch/rules
 *
 * Fixed rules decide risk (ADR-010); AI never does. `analyzeSession` is pure:
 * same input, same output, including finding ids (sha256 of session id, rule
 * id, and subject). Every finding explains itself in plain English and cites
 * its evidence. Every rule has a positive test and a normal-use test.
 *
 * Public API contract. Signatures are fixed; implementations replace the stubs.
 */
import type {
  AnalysisInput,
  AnalysisResult,
  CaptureGap,
  Finding,
  RiskLevel,
  RuleDefinition,
  SessionStatus,
  SessionStatusResult,
  StoredEvent,
} from '@stillwatch/schema';

/** Metadata for every rule, one entry per RULE_IDS value. */
export const RULES: readonly RuleDefinition[] = [];

/** Runs every rule and derives everything the report needs for one session. */
export function analyzeSession(_input: AnalysisInput): AnalysisResult {
  throw new Error('not implemented: analyzeSession');
}

export type StatusInput = {
  /** All session events in display order. */
  events: StoredEvent[];
  current: SessionStatus;
  /** Latest of the last event time and the transcript's modification time. */
  lastActivityAt: number;
  now: number;
  /** Default TIMING.interruptAfterMs. */
  interruptAfterMs?: number;
  /** Default TIMING.abandonAfterMs. */
  abandonAfterMs?: number;
};

/**
 * Session status from its events and activity:
 * - `finished` when a session.end exists and no later events.
 * - `interrupted` when mid-turn (a user prompt without a later turn.stop or
 *   turn.failure, or a tool.pre without its result or batch resolution) and
 *   inactive for `interruptAfterMs`.
 * - `finished` with endReason "no_session_end" when between turns and inactive
 *   for `abandonAfterMs`.
 * - otherwise `active`.
 */
export function deriveSessionStatus(_input: StatusInput): SessionStatusResult {
  throw new Error('not implemented: deriveSessionStatus');
}

/**
 * Session risk: the highest finding severity. With no medium or high finding,
 * a critical capture gap makes the risk `unknown`. Reasons list the findings
 * (and gaps) behind the level, highest first.
 */
export function computeRisk(
  _findings: Finding[],
  _gaps: CaptureGap[],
): { risk: RiskLevel; reasons: string[] } {
  throw new Error('not implemented: computeRisk');
}

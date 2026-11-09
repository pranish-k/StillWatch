/**
 * @stillwatch/rules
 *
 * Fixed rules decide risk (ADR-010); AI never does. `analyzeSession` is pure:
 * same input, same output, including finding ids (sha256 of session id, rule
 * id, and subject). Every finding explains itself in plain English and cites
 * its evidence. Every rule has a positive test and a normal-use test.
 *
 * Public API contract. Signatures are fixed.
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
import { joinPath, pathKey } from '@stillwatch/schema';
import { classifyPath } from '@stillwatch/facts';
import { analyzeWith } from './analyze';
import { RULE_DEFINITIONS } from './rules/definitions';
import { riskOf } from './risk';
import { sessionStatus } from './status';

/** Metadata for every rule, one entry per RULE_IDS value. */
export const RULES: readonly RuleDefinition[] = RULE_DEFINITIONS;

/** Runs every rule and derives everything the report needs for one session. */
export function analyzeSession(input: AnalysisInput): AnalysisResult {
  const repoRoots: string[] = [];
  for (const root of [
    input.session.projectRoot,
    ...(input.start?.repos ?? []).map((r) => r.root),
    ...(input.end?.repos ?? []).map((r) => r.root),
  ]) {
    if (root !== null && !repoRoots.some((r) => pathKey(r) === pathKey(root))) repoRoots.push(root);
  }
  // AnalysisInput carries no Stillwatch data directory; the default location is assumed.
  const context = {
    home: input.home,
    stillwatchHome: joinPath(input.home, '.stillwatch'),
    repoRoots,
  };
  return analyzeWith(input, (path) => classifyPath(path, context));
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
export function deriveSessionStatus(input: StatusInput): SessionStatusResult {
  return sessionStatus(input);
}

/**
 * Session risk: the highest finding severity. With no medium or high finding,
 * a critical capture gap makes the risk `unknown`. Reasons list the findings
 * (and gaps) behind the level, highest first.
 */
export function computeRisk(
  findings: Finding[],
  gaps: CaptureGap[],
): { risk: RiskLevel; reasons: string[] } {
  return riskOf(findings, gaps);
}

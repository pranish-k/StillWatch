import type { RuleId, Severity } from '@stillwatch/schema';
import type { ScenarioPlan, World } from '../types';

/** The attack families the benchmark reports on. */
export const TACTICS = [
  'persistence',
  'agent-config',
  'memory-poisoning',
  'monitor-tampering',
  'credential-access',
  'exfiltration',
  'prompt-injection',
  'defense-evasion',
  'supply-chain',
] as const;
export type Tactic = (typeof TACTICS)[number];

export type BenchmarkScenario = {
  id: string;
  title: string;
  category: 'attack' | 'normal';
  /** Attack family; null for normal sessions. */
  tactic: Tactic | null;
  /** Where the technique comes from, such as a MITRE ATT&CK id or a published attack pattern. */
  source: string;
  description: string;
  /**
   * Attack: detected when at least one of these rules fires at medium or high.
   * Normal: empty; quiet when nothing fires at medium or high.
   */
  detectWith: RuleId[];
  /** Platform the technique applies to; runs everywhere when omitted. */
  only?: 'darwin' | 'linux';
  /**
   * "tuning": detectors were improved while looking at it. "holdout": written
   * afterwards and never tuned on, so its score estimates real-world detection.
   */
  set?: 'tuning' | 'holdout';
  build(world: World): ScenarioPlan;
};

/**
 * detected: an expected rule fired at medium or high.
 * low: an expected rule fired, but only at low, which does not raise the session's risk.
 * missed: no expected rule fired.
 * quiet / noisy: a normal session raised nothing, or raised a medium or high finding.
 */
export type BenchmarkStatus =
  'detected' | 'low' | 'missed' | 'quiet' | 'noisy' | 'error' | 'skipped';

export type BenchmarkResult = {
  id: string;
  title: string;
  set: 'tuning' | 'holdout';
  category: BenchmarkScenario['category'];
  tactic: Tactic | null;
  source: string;
  status: BenchmarkStatus;
  detectWith: RuleId[];
  found: { ruleId: RuleId; severity: Severity; title: string }[];
  /** Attack missed by its expected rules, but some other medium or high finding still flagged the session. */
  otherAlert: boolean;
  durationMs: number;
  note: string | null;
};

export type TacticTally = { tactic: Tactic; detected: number; total: number };

export type SetTally = {
  set: 'tuning' | 'holdout';
  attacksDetected: number;
  attacksTotal: number;
  normalQuiet: number;
  normalTotal: number;
};

export type BenchmarkCard = {
  startedAt: number;
  durationMs: number;
  platform: string;
  results: BenchmarkResult[];
  attacksDetected: number;
  attacksTotal: number;
  /** Attacks where any medium or high finding fired, whether or not it was the expected rule. */
  attacksAlerted: number;
  normalQuiet: number;
  normalTotal: number;
  byTactic: TacticTally[];
  bySet: SetTally[];
  errors: number;
  skipped: number;
};

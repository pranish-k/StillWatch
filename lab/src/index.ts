/**
 * @stillwatch/lab
 *
 * The attack lab (S6-01 to S6-03): safe, local scenarios that replay agent
 * activity through the real capture hook and the real pipeline, plant real
 * files in temporary directories, and check that the expected findings
 * appear. Normal-use scenarios check that nothing high fires (noise baseline).
 *
 * Everything runs in temporary directories with a temporary HOME and
 * STILLWATCH_HOME and fake secrets built at runtime. It never touches the
 * user's real home, settings, crontab, or network.
 *
 * Public API contract. Signatures are fixed; implementations replace the stubs.
 */
import type { RuleId, Severity } from '@stillwatch/schema';
import { runScenarios } from './runner';
import { SCENARIOS } from './scenarios';
import { renderScorecardText } from './scorecard';

export type ScenarioInfo = {
  id: string;
  title: string;
  /** "attack" scenarios must be detected; "normal" scenarios must stay quiet. */
  category: 'attack' | 'normal';
  description: string;
};

export type ScenarioResult = {
  id: string;
  title: string;
  category: ScenarioInfo['category'];
  /** attack: detected or missed. normal: quiet or noisy. error: the scenario itself failed to run. */
  status: 'detected' | 'missed' | 'quiet' | 'noisy' | 'error';
  expected: RuleId[];
  found: { ruleId: RuleId; severity: Severity; title: string }[];
  durationMs: number;
  note: string | null;
};

export type Scorecard = {
  startedAt: number;
  durationMs: number;
  results: ScenarioResult[];
  attacksDetected: number;
  attacksTotal: number;
  normalQuiet: number;
  normalTotal: number;
  errors: number;
};

export type LabOptions = {
  /** Scenario ids to run; default all. */
  scenarios?: string[];
  /** Keep the temporary directories for inspection. */
  keepTemp?: boolean;
  log?: (line: string) => void;
};

export function listScenarios(): ScenarioInfo[] {
  return SCENARIOS.map(({ id, title, category, description }) => ({
    id,
    title,
    category,
    description,
  }));
}

export function runLab(options?: LabOptions): Promise<Scorecard> {
  return runScenarios([...SCENARIOS], options);
}

/** Plain-text scorecard for the terminal. */
export function renderScorecard(card: Scorecard, options?: { color?: boolean }): string {
  return renderScorecardText(card, options);
}

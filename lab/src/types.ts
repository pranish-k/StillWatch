import type { JsonObject, RuleId, Severity } from '@stillwatch/schema';
import type { ScenarioInfo } from './index';

/** The temporary directories one scenario runs in. Every path is absolute and real (no symlinks). */
export type World = {
  /** Temporary root; everything the scenario touches lives below it. */
  root: string;
  /** Temporary HOME for the simulated user. */
  home: string;
  /** Temporary STILLWATCH_HOME (`<home>/.stillwatch`, the default layout). */
  stillwatchHome: string;
  /** The git repository the simulated agent works in. */
  repo: string;
  /** Empty file used as GIT_CONFIG_GLOBAL, so the real git config is never read. */
  gitConfig: string;
};

/** A real change to a file in the temporary world. Paths are absolute and must lie inside the world. */
export type FileEffect =
  | { kind: 'write'; path: string; content: string; mode?: number }
  | { kind: 'append'; path: string; content: string }
  | { kind: 'delete'; path: string }
  | { kind: 'chmod'; path: string; mode: number }
  /** Parses a JSON file, sets top-level keys, and writes it back with the same mode. */
  | { kind: 'json'; path: string; set: JsonObject }
  /** `git add` (all changes when `paths` is null) and `git commit` in `repo`. Hooks never run. */
  | { kind: 'commit'; repo: string; message: string; paths: string[] | null };

/** A raw Claude Code hook payload, in the exact shape Claude Code writes to the hook's stdin. */
export type HookPayload = JsonObject & { session_id: string; hook_event_name: string };

export type Step =
  /** Send a payload through the real capture hook script. */
  | { kind: 'hook'; event: string; payload: HookPayload }
  | { kind: 'effect'; effect: FileEffect }
  | { kind: 'import' }
  /** Analyze every session with pending events, as the collector's debounce would between sessions. */
  | { kind: 'analyze' }
  /**
   * Moves the injected clock forward. Receive times come from spool file
   * modification times (real time), so only advance after the last event.
   */
  | { kind: 'advance'; ms: number }
  | { kind: 'sweep' };

export type SessionRef = { key: string; id: string };

export type ScenarioPlan = {
  /** Applied before the session starts, then committed (ignored files stay untracked). */
  setup: FileEffect[];
  steps: Step[];
  sessions: SessionRef[];
};

export type Expectation = {
  ruleId: RuleId;
  /** Session key the finding must belong to; any session when omitted. */
  session?: string;
  /** The finding must fire at this severity or lower. */
  maxSeverity?: Severity;
};

export type Scenario = ScenarioInfo & {
  /** Attack: every expectation must be met. Normal: empty; no medium or high finding may fire. */
  expect: Expectation[];
  build(world: World): ScenarioPlan;
};

/** A finding as the lab sees it, tagged with the session key it belongs to. */
export type ObservedFinding = {
  session: string;
  ruleId: RuleId;
  severity: Severity;
  title: string;
};

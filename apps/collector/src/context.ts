/**
 * Shared state of one pipeline instance, passed to the import, snapshot,
 * analysis, and sweep modules, plus small helpers they all use.
 */
import {
  newId,
  TIMING,
  type CaptureGap,
  type GapSource,
  type StillwatchConfig,
  type StillwatchPaths,
} from '@stillwatch/schema';
import type { Redactor } from '@stillwatch/redaction';
import type { Store } from '@stillwatch/storage';
import type { PipelineDeps } from './deps';
import type { Logger } from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;

export type Timing = { [K in keyof typeof TIMING]: number };

export function resolveTiming(overrides: Partial<Timing> | undefined): Timing {
  return { ...TIMING, ...overrides };
}

export type PipelineContext = {
  stillwatchHome: string;
  paths: StillwatchPaths;
  userHome: string;
  includeSystemSurface: boolean;
  platform: 'darwin' | 'linux';
  now: () => number;
  logger: Logger;
  gitBinary: string | undefined;
  timing: Timing;
  deps: PipelineDeps;
  store: Store;
  config: StillwatchConfig;
  redactor: Redactor;
};

export type GapInput = {
  sessionId: string | null;
  source: GapSource;
  severity: CaptureGap['severity'];
  reason: string;
  startedAt?: number | null;
  endedAt?: number | null;
};

/** Records a capture gap. Never throws: a failure to record a gap is logged. */
export function recordGap(ctx: PipelineContext, input: GapInput): void {
  const now = ctx.now();
  const gap: CaptureGap = {
    id: newId(now),
    sessionId: input.sessionId,
    source: input.source,
    severity: input.severity,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    reason: input.reason,
    createdAt: now,
  };
  try {
    ctx.store.addGap(gap);
  } catch (err) {
    ctx.logger.error('failed to record capture gap', {
      source: input.source,
      error: err instanceof Error ? err.name : 'unknown',
    });
  }
}

/** Runs async tasks one at a time, in submission order. A failed task does not stop later ones. */
export class SerialLane {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Resolves when everything submitted so far has finished. */
  idle(): Promise<void> {
    return this.tail.then(() => undefined);
  }
}

export function currentPlatform(): 'darwin' | 'linux' {
  return process.platform === 'darwin' ? 'darwin' : 'linux';
}

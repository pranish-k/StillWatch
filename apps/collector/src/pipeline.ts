import type { StillwatchConfig } from '@stillwatch/schema';
import type { Store } from '@stillwatch/storage';
import { defaultDeps } from './deps';
import { buildPipeline } from './pipeline-core';
import type { Logger } from './types';

export type PipelineOptions = {
  stillwatchHome: string;
  /** The user's home directory, for the persistence surface and path display. Default os.homedir(). */
  userHome?: string;
  /** Include system-level surface entries (crontab, /etc, /Library). Default true; the lab sets false. */
  includeSystemSurface?: boolean;
  /** Injectable clock. */
  now?: () => number;
  logger?: Logger;
  gitBinary?: string;
  /** Overrides for TIMING values. */
  timing?: Partial<{
    snapshotFreshMs: number;
    interruptAfterMs: number;
    abandonAfterMs: number;
    analysisDebounceMs: number;
    liveDiffMinIntervalMs: number;
    sweepIntervalMs: number;
    spoolPollMs: number;
    staleTmpMs: number;
  }>;
};

export type ImportStats = {
  /** Spool files seen. */
  files: number;
  imported: number;
  duplicates: number;
  failed: number;
  snapshots: number;
};

export type Pipeline = {
  readonly store: Store;
  readonly config: StillwatchConfig;
  /** Imports everything currently in spool/new, oldest first. */
  importOnce(): Promise<ImportStats>;
  /** Analyzes every session with pending events. Returns the analyzed session ids. */
  analyzePending(): Promise<string[]>;
  /** Re-analyzes one session now. */
  analyzeSession(sessionId: string): Promise<void>;
  /** Status transitions, end snapshots for closed sessions, stale tmp cleanup, retention. */
  sweep(): Promise<void>;
  close(): Promise<void>;
};

/**
 * Opens the data directory, config, and database, and returns the import and
 * analysis pipeline. Callers own it and must `close()` it.
 */
export function createPipeline(options: PipelineOptions): Promise<Pipeline> {
  return buildPipeline(options, defaultDeps());
}

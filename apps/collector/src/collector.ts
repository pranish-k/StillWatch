import type { Pipeline, PipelineOptions } from './pipeline';

export type CollectorOptions = PipelineOptions & {
  /** Default: config.port. 0 picks a free port (tests). */
  port?: number;
  /** Directory with the built dashboard (index.html, assets/). `null` serves a short notice instead. */
  webRoot: string | null;
  version: string;
};

export type CollectorHandle = {
  readonly port: number;
  readonly pipeline: Pipeline;
  stop(): Promise<void>;
};

/**
 * Starts the collector in this process: takes the single-instance lock
 * (run/collector.pid), binds 127.0.0.1 only, watches the spool, runs timers,
 * and serves the API through `startHttpServer` from ./server.
 * Rejects if another live collector holds the lock.
 */
export function runCollector(_options: CollectorOptions): Promise<CollectorHandle> {
  return Promise.reject(new Error('not implemented: runCollector'));
}

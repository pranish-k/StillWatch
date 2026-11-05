export type CollectorProcessStatus = { running: boolean; pid: number | null; port: number | null };

export function collectorStatus(_stillwatchHome: string): Promise<CollectorProcessStatus> {
  return Promise.reject(new Error('not implemented: collectorStatus'));
}

/** Spawns `<nodePath> <cliPath> collector run` detached (own session, stdio to the log file). */
export function startCollectorDetached(_options: {
  stillwatchHome: string;
  nodePath: string;
  cliPath: string;
}): Promise<{ pid: number }> {
  return Promise.reject(new Error('not implemented: startCollectorDetached'));
}

/** Sends SIGTERM and waits for exit. Returns false when no collector was running. */
export function stopCollector(
  _stillwatchHome: string,
  _options?: { timeoutMs?: number },
): Promise<boolean> {
  return Promise.reject(new Error('not implemented: stopCollector'));
}

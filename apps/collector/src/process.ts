/**
 * Managing the collector from another process (the CLI): status from the
 * pid file, a detached start, and a graceful stop.
 */
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { STILLWATCH_HOME_ENV, stillwatchPaths } from '@stillwatch/schema';
import { ensureDataDirs } from './config';
import { FILE_MODE, removeFile } from './fs-safe';
import { isLiveCollector, readPidFile } from './pidfile';

export type CollectorProcessStatus = { running: boolean; pid: number | null; port: number | null };

const STOP_POLL_MS = 50;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const KILL_WAIT_MS = 1_000;

/** Running once a live collector has recorded its port (it is listening). */
export async function collectorStatus(stillwatchHome: string): Promise<CollectorProcessStatus> {
  const record = await readPidFile(stillwatchPaths(stillwatchHome).pidFile);
  if (record === null || !(await isLiveCollector(record)))
    return { running: false, pid: null, port: null };
  return { running: record.port !== null, pid: record.pid, port: record.port };
}

/** Spawns `<nodePath> <cliPath> collector run` detached (own session, stdio to the log file). */
export async function startCollectorDetached(options: {
  stillwatchHome: string;
  nodePath: string;
  cliPath: string;
}): Promise<{ pid: number }> {
  await ensureDataDirs(options.stillwatchHome);
  const log = await open(stillwatchPaths(options.stillwatchHome).logFile, 'a', FILE_MODE);
  try {
    const child = spawn(options.nodePath, [options.cliPath, 'collector', 'run'], {
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
      env: { ...process.env, [STILLWATCH_HOME_ENV]: options.stillwatchHome },
    });
    const pid = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => {
        if (child.pid === undefined) reject(new Error('the collector process has no pid'));
        else resolve(child.pid);
      });
    });
    child.unref();
    return { pid };
  } finally {
    await log.close();
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += STOP_POLL_MS) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, STOP_POLL_MS));
  }
  return !alive(pid);
}

/**
 * Sends SIGTERM and waits for exit, then SIGKILL if it does not stop in time.
 * Returns false when no collector was running.
 */
export async function stopCollector(
  stillwatchHome: string,
  options?: { timeoutMs?: number },
): Promise<boolean> {
  const pidFile = stillwatchPaths(stillwatchHome).pidFile;
  const record = await readPidFile(pidFile);
  if (record === null) return false;
  if (!(await isLiveCollector(record))) {
    await removeFile(pidFile);
    return false;
  }
  if (record.pid === process.pid)
    throw new Error('refusing to stop the collector running in this process');
  process.kill(record.pid, 'SIGTERM');
  if (!(await waitForExit(record.pid, options?.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS))) {
    process.kill(record.pid, 'SIGKILL');
    await waitForExit(record.pid, KILL_WAIT_MS);
  }
  // A killed collector cannot remove its own lock.
  const left = await readPidFile(pidFile);
  if (left?.pid === record.pid) await removeFile(pidFile);
  return true;
}

/**
 * The single-instance lock, run/collector.pid. The first line is the pid (the
 * capture hook reads only that line), then the port once the server listens,
 * then the start time in milliseconds.
 *
 * A pid file can outlive its process (a crash, a reboot), and the pid can be
 * reused by an unrelated process. A recorded pid counts as a live collector
 * only when the process exists and did not start after the recorded start time.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { hasErrorCode, removeFile, writeFileAtomic, writeFileExclusive } from './fs-safe';

export type PidRecord = { pid: number; port: number | null; startedAt: number | null };

/** Slack between the recorded start time and the process start time reported by ps. */
const START_SLACK_MS = 5_000;
const PS_TIMEOUT_MS = 2_000;
const LOCK_ATTEMPTS = 3;

export function formatPidRecord(record: PidRecord): string {
  return `${record.pid}\n${record.port ?? ''}\n${record.startedAt ?? ''}\n`;
}

export function parsePidRecord(text: string): PidRecord | null {
  const [pidLine = '', portLine = '', startLine = ''] = text.split('\n');
  if (!/^[1-9]\d{0,9}$/.test(pidLine)) return null;
  const port = /^\d{1,5}$/.test(portLine) ? Number(portLine) : null;
  const startedAt = /^\d{1,15}$/.test(startLine) ? Number(startLine) : null;
  return {
    pid: Number(pidLine),
    port: port !== null && port > 0 && port < 65_536 ? port : null,
    startedAt,
  };
}

async function readRaw(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (hasErrorCode(err, 'ENOENT')) return null;
    throw err;
  }
}

export async function readPidFile(path: string): Promise<PidRecord | null> {
  const raw = await readRaw(path);
  return raw === null ? null : parsePidRecord(raw);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else.
    return hasErrorCode(err, 'EPERM');
  }
}

/** Parses ps `etime`, `[[dd-]hh:]mm:ss`, into seconds. */
export function parseElapsed(text: string): number | null {
  const m = /^\s*(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)\s*$/.exec(text);
  if (m === null) return null;
  const [, d = '0', h = '0', min = '0', s = '0'] = m;
  return ((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60 + Number(s);
}

function elapsedSeconds(pid: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['-o', 'etime=', '-p', String(pid)],
      { timeout: PS_TIMEOUT_MS },
      (err, stdout) => {
        resolve(err === null ? parseElapsed(stdout) : null);
      },
    );
  });
}

/** True when the recorded collector is still running. */
export async function isLiveCollector(
  record: PidRecord,
  now: number = Date.now(),
): Promise<boolean> {
  if (!processExists(record.pid)) return false;
  if (record.pid === process.pid || record.startedAt === null) return true;
  const elapsed = await elapsedSeconds(record.pid);
  // When ps cannot tell, trust the pid rather than risk two collectors.
  if (elapsed === null) return true;
  const processStart = now - elapsed * 1000;
  return processStart <= record.startedAt + START_SLACK_MS;
}

export class CollectorRunningError extends Error {
  readonly pid: number;

  constructor(pid: number) {
    super(`another collector is running (pid ${pid})`);
    this.name = 'CollectorRunningError';
    this.pid = pid;
  }
}

/**
 * Takes the lock for this process, replacing a stale pid file. Throws
 * CollectorRunningError when a live collector holds it.
 */
export async function acquirePidLock(path: string, record: PidRecord): Promise<void> {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    if (await writeFileExclusive(path, formatPidRecord(record))) return;
    const raw = await readRaw(path);
    if (raw === null) continue;
    const held = parsePidRecord(raw);
    if (held !== null && (await isLiveCollector(held))) throw new CollectorRunningError(held.pid);
    // Stale. Remove it only if it is still the file judged stale, so a lock
    // another starting collector just took is never deleted.
    if ((await readRaw(path)) === raw) await removeFile(path);
  }
  throw new Error('could not take the collector lock (run/collector.pid keeps changing)');
}

/** Rewrites the lock with the port once the server listens. */
export async function updatePidLock(path: string, record: PidRecord): Promise<void> {
  await writeFileAtomic(path, formatPidRecord(record));
}

/** Removes the lock if this process still holds it. */
export async function releasePidLock(path: string, pid: number): Promise<void> {
  const held = await readPidFile(path).catch(() => null);
  if (held?.pid === pid) await removeFile(path);
}

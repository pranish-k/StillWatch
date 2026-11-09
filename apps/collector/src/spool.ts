/**
 * Reading the maildir-style spool (ADR-017). File names and contents are
 * untrusted. The receive time of a record is its modification time.
 */
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hasErrorCode } from './fs-safe';

export type SpoolEntry = {
  name: string;
  path: string;
  /** Modification time in nanoseconds, for exact ordering. */
  mtimeNs: bigint;
  /** Modification time, epoch milliseconds with sub-millisecond precision. */
  receivedAt: number;
  size: number;
  /** False for directories, symlinks, and other non-regular entries. */
  regular: boolean;
};

/** Epoch milliseconds (microsecond precision) from a nanosecond timestamp. */
/** Nanoseconds to whole milliseconds, rounded. Ordering uses the full nanosecond value. */
export function nsToMs(ns: bigint): number {
  return Number((ns + 500_000n) / 1_000_000n);
}

/**
 * Lists a spool directory, oldest first (modification time, then name).
 * Entries that vanish while listing are skipped. A missing directory is empty.
 */
export async function listSpool(dir: string): Promise<SpoolEntry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (hasErrorCode(err, 'ENOENT')) return [];
    throw err;
  }
  const entries: SpoolEntry[] = [];
  for (const name of names) {
    const path = join(dir, name);
    try {
      const info = await lstat(path, { bigint: true });
      entries.push({
        name,
        path,
        mtimeNs: info.mtimeNs,
        receivedAt: nsToMs(info.mtimeNs),
        size: Number(info.size),
        regular: info.isFile(),
      });
    } catch (err) {
      if (!hasErrorCode(err, 'ENOENT')) throw err;
    }
  }
  entries.sort(compareEntries);
  return entries;
}

function compareEntries(a: SpoolEntry, b: SpoolEntry): number {
  if (a.mtimeNs !== b.mtimeNs) return a.mtimeNs < b.mtimeNs ? -1 : 1;
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

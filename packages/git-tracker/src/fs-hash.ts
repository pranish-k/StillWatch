/** Bounded, symlink-safe file hashing. Reads content only to hash it; nothing is kept. */
import { createHash, type Hash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { open } from 'node:fs/promises';
import { type ObjectFormat } from './constants';

const CHUNK_BYTES = 64 * 1024;

/** Never follow a symlink swapped in after lstat, and never block on a FIFO. */
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Stand-in hash for content too large to read. */
export function sizeMtimeHash(stats: Stats): string {
  return `size:${stats.size}:mtime:${Math.floor(stats.mtimeMs)}`;
}

/**
 * Feeds at most `limit` bytes of a regular file into `hash`. Returns the bytes
 * read, or null when the file is not a regular file or holds more than `limit`.
 */
async function feedFile(path: string, hash: Hash, limit: number): Promise<number | null> {
  const handle = await open(path, OPEN_FLAGS);
  try {
    if (!(await handle.stat()).isFile()) return null;
    const buffer = Buffer.alloc(CHUNK_BYTES);
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, null);
      if (bytesRead === 0) return total;
      total += bytesRead;
      if (total > limit) return null;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
}

/** sha256 of a regular file up to `maxBytes`, else "size:<n>:mtime:<ms>". */
export async function hashFileContent(
  path: string,
  stats: Stats,
  maxBytes: number,
): Promise<string> {
  if (stats.size > maxBytes) return sizeMtimeHash(stats);
  const hash = createHash('sha256');
  const read = await feedFile(path, hash, maxBytes);
  return read === null ? sizeMtimeHash(stats) : hash.digest('hex');
}

/** Git blob id of in-memory content (used for symlink targets). */
export function gitBlobId(format: ObjectFormat, content: Buffer): string {
  return createHash(format).update(`blob ${content.length}\0`).update(content).digest('hex');
}

/**
 * Git blob id of a regular file without filters, computed in process. Used when
 * `git hash-object` fails. Returns null when the file changed while being read.
 */
export async function gitBlobIdOfFile(
  format: ObjectFormat,
  path: string,
  stats: Stats,
): Promise<string | null> {
  const hash = createHash(format).update(`blob ${stats.size}\0`);
  const read = await feedFile(path, hash, stats.size);
  return read === stats.size ? hash.digest('hex') : null;
}

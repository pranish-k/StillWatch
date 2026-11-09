/**
 * Small filesystem helpers for files and directories Stillwatch owns:
 * private modes (0700 directories, 0600 files), atomic and exclusive writes,
 * and errno checks. Nothing here logs or inspects file contents.
 */
import { constants as fsConstants } from 'node:fs';
import { chmod, link, mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomToken } from '@stillwatch/schema';

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

/** True when `err` is a Node system error with the given `code` (e.g. "ENOENT"). */
export function hasErrorCode(err: unknown, code: string): boolean {
  return err instanceof Error && 'code' in err && err.code === code;
}

/**
 * Short, single-line description of an error for logs: name, code, and a
 * capped message. Callers must not pass errors whose message embeds payload text.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'non-error thrown';
  const code = 'code' in err && typeof err.code === 'string' ? ` ${err.code}` : '';
  const message = err.message.replace(/\s+/g, ' ').slice(0, 200);
  return `${err.name}${code}: ${message}`;
}

/**
 * Creates `dir` (and parents) with mode 0700. When it already exists, checks
 * that it is a directory and removes group and other permission bits.
 */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  const info = await stat(dir);
  if (!info.isDirectory()) throw new Error(`not a directory: ${dir}`);
  if ((info.mode & 0o077) !== 0 || (info.mode & DIR_MODE) !== DIR_MODE) {
    await chmod(dir, DIR_MODE);
  }
}

/** Removes a file, ignoring a file that is already gone. Returns true when this call removed it. */
export async function removeFile(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (err) {
    if (hasErrorCode(err, 'ENOENT')) return false;
    throw err;
  }
}

function tempPathFor(path: string): string {
  return `${path}.${randomToken(9).replace(/[^A-Za-z0-9]/g, 'x')}.tmp`;
}

/** Writes `data` to a new temporary file next to `path`, fsyncs it, and returns its path. */
async function writeTemp(path: string, data: string): Promise<string> {
  const tmp = tempPathFor(path);
  const handle = await open(
    tmp,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
    FILE_MODE,
  );
  try {
    await handle.writeFile(data, 'utf8');
    await handle.chmod(FILE_MODE);
    await handle.sync();
  } catch (err) {
    await handle.close().catch(() => undefined);
    await removeFile(tmp).catch(() => undefined);
    throw err;
  }
  await handle.close();
  return tmp;
}

/** Best-effort fsync of a directory, so a rename survives a crash. */
async function syncDir(dir: string): Promise<void> {
  try {
    const handle = await open(dir, fsConstants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Some filesystems refuse fsync on directories; the rename already happened.
  }
}

/** Atomically replaces `path` with `data` (temp file, fsync, rename), mode 0600. */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tmp = await writeTemp(path, data);
  try {
    await rename(tmp, path);
  } catch (err) {
    await removeFile(tmp).catch(() => undefined);
    throw err;
  }
  await syncDir(dirname(path));
}

/**
 * Creates `path` with `data` only if it does not exist. The file appears with
 * its full content (temp file, then a hard link), so readers never see it
 * half-written. Returns false when `path` already existed.
 */
export async function writeFileExclusive(path: string, data: string): Promise<boolean> {
  const tmp = await writeTemp(path, data);
  try {
    await link(tmp, path);
    await syncDir(dirname(path));
    return true;
  } catch (err) {
    if (hasErrorCode(err, 'EEXIST')) return false;
    throw err;
  } finally {
    await removeFile(tmp).catch(() => undefined);
  }
}

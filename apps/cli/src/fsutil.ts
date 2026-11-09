import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Writes a file atomically (temp file, fsync, rename) with the given mode. */
export async function writeFileAtomic(path: string, text: string, mode: number): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await open(tmp, 'wx', mode);
  try {
    try {
      await handle.writeFile(text, 'utf8');
      await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** Finds an executable on a PATH string, like the shell would. */
export async function findExecutable(
  name: string,
  pathValue: string | undefined,
): Promise<string | null> {
  for (const dir of (pathValue ?? '').split(':')) {
    if (dir === '' || !dir.startsWith('/')) continue;
    const candidate = join(dir, name);
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

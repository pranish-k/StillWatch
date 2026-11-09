/**
 * The Node binary and CLI file that the hook script uses to start the
 * collector. Both are stored at install time and run later, so they must
 * still exist after npm cleans its caches or Homebrew upgrades Node.
 */
import { randomBytes } from 'node:crypto';
import { cp, mkdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { stillwatchPaths } from '@stillwatch/schema';
import { exists, findExecutable } from './fsutil';

export type RuntimePaths = {
  nodePath: string;
  cliPath: string;
  /** Where the CLI was copied, or null when it runs from where it was installed. */
  copiedTo: string | null;
};

/**
 * True when the CLI runs from a cache that the package manager may delete,
 * such as `npx stillwatch` or `pnpm dlx stillwatch`.
 */
export function isTemporaryInstall(cliPath: string): boolean {
  return cliPath.includes('/_npx/') || cliPath.includes('/pnpm/dlx/');
}

async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    return (await realpath(a)) === (await realpath(b));
  } catch {
    return false;
  }
}

/**
 * Prefers the `node` on PATH when it is the same binary as `execPath`.
 * Homebrew runs Node from a versioned Cellar path that disappears on upgrade,
 * while `/opt/homebrew/bin/node` keeps pointing at the current version.
 */
export async function stableNodePath(
  execPath: string,
  pathValue: string | undefined,
): Promise<string> {
  const onPath = await findExecutable('node', pathValue);
  if (onPath !== null && onPath !== execPath && (await sameFile(onPath, execPath))) return onPath;
  return execPath;
}

/**
 * Copies the directory holding the bundled CLI (`stillwatch.mjs`, `web/`)
 * to `appDir`, replacing any earlier copy, and returns the copied CLI path.
 */
export async function copyApp(cliPath: string, appDir: string): Promise<string> {
  const parent = dirname(appDir);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const suffix = randomBytes(6).toString('hex');
  const tmp = join(parent, `.${basename(appDir)}.${suffix}.tmp`);
  const old = join(parent, `.${basename(appDir)}.${suffix}.old`);
  try {
    await cp(dirname(cliPath), tmp, { recursive: true });
    const hadCopy = await exists(appDir);
    if (hadCopy) await rename(appDir, old);
    await rename(tmp, appDir);
    if (hadCopy) await rm(old, { recursive: true, force: true });
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    throw error;
  }
  return join(appDir, basename(cliPath));
}

/** Decides, and when needed prepares, the paths the hook will run. */
export async function installRuntime(options: {
  stillwatchHome: string;
  execPath: string;
  cliPath: string;
  pathValue: string | undefined;
}): Promise<RuntimePaths> {
  const nodePath = await stableNodePath(options.execPath, options.pathValue);
  if (!isTemporaryInstall(options.cliPath)) {
    return { nodePath, cliPath: options.cliPath, copiedTo: null };
  }
  const appDir = stillwatchPaths(options.stillwatchHome).app;
  const cliPath = await copyApp(options.cliPath, appDir);
  return { nodePath, cliPath, copiedTo: appDir };
}

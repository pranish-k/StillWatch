/** Turns the paths reported by `git status` into the overlay: relative path to blob id. */
import { type Stats } from 'node:fs';
import { lstat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { SUBMODULE_MARKER } from './constants';
import { gitBlobId, gitBlobIdOfFile } from './fs-hash';
import { type GitRunner, type RepoGitContext } from './git-runner';
import { quoteForStdinPath, splitLines } from './nul';

export type OverlayResult = {
  overlay: Record<string, string | null>;
  errors: string[];
};

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch {
    return null;
  }
}

/**
 * Hashes regular files with one `git hash-object --no-filters --stdin-paths`
 * call. Falls back to hashing in process when git fails (for example when a
 * file vanished between status and hashing).
 */
async function hashRegularFiles(
  git: GitRunner,
  root: string,
  repo: RepoGitContext,
  files: { path: string; stats: Stats }[],
): Promise<{ ids: Map<string, string | null>; error: string | null }> {
  const ids = new Map<string, string | null>();
  if (files.length === 0) return { ids, error: null };
  const input = files.map((file) => `${quoteForStdinPath(file.path)}\n`).join('');
  const result = await git.run(['hash-object', '--no-filters', '--stdin-paths'], {
    cwd: root,
    repo,
    input,
  });
  const lines = result.ok ? splitLines(result.stdout) : [];
  if (result.ok && lines.length === files.length) {
    files.forEach((file, index) => ids.set(file.path, lines[index] ?? null));
    return { ids, error: null };
  }
  let failed = 0;
  for (const file of files) {
    let id: string | null = null;
    try {
      id = await gitBlobIdOfFile(repo.objectFormat, join(root, file.path), file.stats);
    } catch {
      // Vanished or unreadable: recorded as absent below.
    }
    if (id === null) failed += 1;
    ids.set(file.path, id);
  }
  const error =
    failed > 0 ? `could not hash ${failed} changed file(s): ${result.error ?? 'changed'}` : null;
  return { ids, error };
}

/**
 * Builds the overlay for `paths` (already capped). Deleted paths map to null,
 * submodules and embedded repositories to SUBMODULE_MARKER, symlinks to the
 * blob id of their target text. Files of other types (FIFOs, sockets) cannot be
 * stored by git and count as absent.
 */
export async function buildOverlay(
  git: GitRunner,
  root: string,
  repo: RepoGitContext,
  paths: string[],
): Promise<OverlayResult> {
  const overlay: Record<string, string | null> = {};
  const errors: string[] = [];
  const stats = await Promise.all(paths.map((path) => lstatOrNull(join(root, path))));
  const regular: { path: string; stats: Stats }[] = [];

  await Promise.all(
    paths.map(async (path, index) => {
      const info = stats[index] ?? null;
      if (info === null) {
        overlay[path] = null;
      } else if (info.isFile()) {
        regular.push({ path, stats: info });
      } else if (info.isSymbolicLink()) {
        try {
          const target = await readlink(join(root, path), { encoding: 'buffer' });
          overlay[path] = gitBlobId(repo.objectFormat, target);
        } catch {
          overlay[path] = null;
        }
      } else if (info.isDirectory()) {
        overlay[path] = SUBMODULE_MARKER;
      } else {
        overlay[path] = null;
      }
    }),
  );

  const hashed = await hashRegularFiles(git, root, repo, regular);
  // An unhashable file is left out rather than recorded as deleted; the error says so.
  for (const [path, id] of hashed.ids) if (id !== null) overlay[path] = id;
  if (hashed.error !== null) errors.push(hashed.error);

  const sorted: Record<string, string | null> = {};
  for (const key of Object.keys(overlay).sort()) sorted[key] = overlay[key] ?? null;
  return { overlay: sorted, errors };
}

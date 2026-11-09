/**
 * Persistence surface snapshot: files, directories, and command output outside
 * (and inside) repositories, recorded as hashes. Symlinks are never followed.
 */
import { execFile } from 'node:child_process';
import { type Stats } from 'node:fs';
import { lstat, opendir, readlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  type RepoSnapshot,
  type RepoSurfaceSpec,
  type SurfaceEntry,
  type SurfaceSpec,
} from '@stillwatch/schema';
import { DEFAULTS } from './constants';
import { hashFileContent, sha256Hex } from './fs-hash';

export type SurfaceLimits = { maxHashBytes: number; maxDirChildren: number };

type PathTarget = Pick<SurfaceEntry, 'path' | 'kind' | 'class' | 'label'>;

const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);
const IO_CONCURRENCY = 16;

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyEntry(target: PathTarget): SurfaceEntry {
  return {
    ...target,
    exists: false,
    hash: null,
    size: null,
    mode: null,
    children: null,
    error: null,
  };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Hash of a symlink's target text, prefixed so it never equals a content hash. */
async function symlinkHash(path: string): Promise<{ hash: string; size: number }> {
  const target = await readlink(path, { encoding: 'buffer' });
  return { hash: `symlink:${sha256Hex(target)}`, size: target.length };
}

/** Child value: content hash for files, "dir", "symlink:<hash>", or "special". */
async function childValue(path: string, limits: SurfaceLimits): Promise<string> {
  try {
    const stats = await lstat(path);
    if (stats.isDirectory()) return 'dir';
    if (stats.isSymbolicLink()) return (await symlinkHash(path)).hash;
    if (stats.isFile()) return await hashFileContent(path, stats, limits.maxHashBytes);
    return 'special';
  } catch (error) {
    return MISSING_CODES.has(errorCode(error) ?? '') ? 'missing' : 'unreadable';
  }
}

/** Non-recursive child map (sorted, capped) and a hash over the full listing. */
async function snapshotDirectory(
  path: string,
  limits: SurfaceLimits,
): Promise<{ hash: string; children: Record<string, string> }> {
  const names: string[] = [];
  const dir = await opendir(path);
  for await (const entry of dir) {
    names.push(entry.name);
    if (names.length >= DEFAULTS.maxDirScan) break;
  }
  names.sort();
  const recorded = names.slice(0, Math.max(0, limits.maxDirChildren));
  const values = await mapLimit(recorded, IO_CONCURRENCY, (name) =>
    childValue(join(path, name), limits),
  );
  const children: Record<string, string> = {};
  const listing: string[] = [];
  recorded.forEach((name, index) => {
    const value = values[index] ?? 'unreadable';
    children[name] = value;
    listing.push(`${name}\0${value}\0`);
  });
  // Children beyond the cap still count by name, so additions and removals change the hash.
  for (const name of names.slice(recorded.length)) listing.push(`${name}\0\0`);
  return { hash: sha256Hex(listing.join('')), children };
}

async function snapshotPath(target: PathTarget, limits: SurfaceLimits): Promise<SurfaceEntry> {
  const entry = emptyEntry(target);
  let stats: Stats;
  try {
    stats = await lstat(target.path);
  } catch (error) {
    if (MISSING_CODES.has(errorCode(error) ?? '')) return entry;
    return { ...entry, error: errorText(error) };
  }
  const found = { ...entry, exists: true, mode: stats.mode };
  try {
    if (stats.isSymbolicLink()) {
      const link = await symlinkHash(target.path);
      return { ...found, hash: link.hash, size: link.size };
    }
    if (stats.isDirectory()) {
      const dir = await snapshotDirectory(target.path, limits);
      return { ...found, hash: dir.hash, children: dir.children };
    }
    if (stats.isFile()) {
      const hash = await hashFileContent(target.path, stats, limits.maxHashBytes);
      return { ...found, hash, size: stats.size };
    }
    return { ...found, size: stats.size };
  } catch (error) {
    return { ...found, error: errorText(error) };
  }
}

/** Runs a fixed argv without a shell and hashes its standard output. */
function snapshotCommand(spec: SurfaceSpec): Promise<SurfaceEntry> {
  const entry = emptyEntry({
    path: spec.path,
    kind: spec.kind,
    class: spec.class,
    label: spec.label,
  });
  const [file, ...args] = spec.argv ?? [];
  if (file === undefined || file === '') {
    return Promise.resolve({ ...entry, error: 'command entry without argv' });
  }
  return new Promise((done) => {
    const child = execFile(
      file,
      args,
      {
        timeout: DEFAULTS.commandTimeoutMs,
        maxBuffer: DEFAULTS.commandMaxBuffer,
        encoding: 'buffer',
        killSignal: 'SIGKILL',
        windowsHide: true,
      },
      (error, stdout) => {
        if (error === null) {
          done({ ...entry, exists: true, hash: sha256Hex(stdout), size: stdout.length });
        } else if (error.code === 'ENOENT') {
          done(entry);
        } else if (typeof error.code === 'number' && stdout.length === 0) {
          // For example `crontab -l` without a crontab.
          done(entry);
        } else if (typeof error.code === 'number') {
          done({ ...entry, exists: true, hash: sha256Hex(stdout), size: stdout.length });
        } else {
          done({ ...entry, error: error.killed ? 'command timed out' : error.message });
        }
      },
    );
    child.stdin?.on('error', () => undefined);
    child.stdin?.end();
  });
}

/** Resolves each repository surface spec against each repository's bases. */
export function resolveRepoSurface(specs: RepoSurfaceSpec[], repos: RepoSnapshot[]): PathTarget[] {
  const targets: PathTarget[] = [];
  for (const repo of repos) {
    const bases: Record<RepoSurfaceSpec['base'], string | null> = {
      // Without a common dir the repository was never resolved and `root` is just the input directory.
      worktree: repo.gitCommonDir === null ? null : repo.root,
      git_common_dir: repo.gitCommonDir,
      hooks_path: repo.hooksPath,
    };
    for (const spec of specs) {
      const base = bases[spec.base];
      if (base === null) continue;
      targets.push({
        path: resolve(base, spec.rel),
        kind: spec.kind,
        class: spec.class,
        label: spec.label,
      });
    }
  }
  return targets;
}

/** Snapshots all entries, one per path (the first spec for a path wins). */
export async function snapshotSurface(
  surface: SurfaceSpec[],
  repoTargets: PathTarget[],
  limits: SurfaceLimits,
): Promise<SurfaceEntry[]> {
  const seen = new Set<string>();
  const jobs: (() => Promise<SurfaceEntry>)[] = [];
  for (const spec of surface) {
    const key = `${spec.kind === 'command' ? 'command' : 'path'}:${spec.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (spec.kind === 'command') jobs.push(() => snapshotCommand(spec));
    else {
      const target: PathTarget = {
        path: spec.path,
        kind: spec.kind,
        class: spec.class,
        label: spec.label,
      };
      jobs.push(() => snapshotPath(target, limits));
    }
  }
  for (const target of repoTargets) {
    const key = `path:${target.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push(() => snapshotPath(target, limits));
  }
  return mapLimit(jobs, IO_CONCURRENCY, (job) => job());
}

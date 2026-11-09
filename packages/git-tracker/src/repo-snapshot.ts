/** Snapshot of one repository: HEAD, branch, hooks path, and the working tree overlay. */
import { type RepoSnapshot } from '@stillwatch/schema';
import { type GitRunner } from './git-runner';
import { buildOverlay } from './overlay';
import { loadRepoContext, type RepoInfo } from './repo-context';
import { readStatus } from './status';

export async function snapshotRepo(
  git: GitRunner,
  info: RepoInfo,
  maxOverlay: number,
): Promise<RepoSnapshot> {
  const snapshot: RepoSnapshot = {
    root: info.root,
    gitCommonDir: info.gitCommonDir,
    head: null,
    branch: null,
    hooksPath: info.hooksPath,
    overlay: {},
    overlayTruncated: false,
    error: null,
  };
  const repo = await loadRepoContext(git, info.root, info.objectFormat);
  if ('error' in repo) return { ...snapshot, error: repo.error };

  const status = await readStatus(git, info.root, repo);
  if (status.error !== null) return { ...snapshot, error: `git status: ${status.error}` };

  const paths = status.paths.slice(0, Math.max(0, maxOverlay));
  const built = await buildOverlay(git, info.root, repo, paths);
  return {
    ...snapshot,
    head: status.head,
    branch: status.branch,
    overlay: built.overlay,
    overlayTruncated: status.truncated || status.paths.length > paths.length,
    error: built.errors.length > 0 ? built.errors.join('; ') : null,
  };
}

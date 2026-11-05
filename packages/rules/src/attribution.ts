/**
 * Attribution: merges what the session wrote with what snapshots saw, per
 * path, and decides who changed each path (ADR-021). A change no recorded
 * action explains is `unattributed`.
 */
import {
  isWithin,
  joinPath,
  pathKey,
  relativeTo,
  type AnalysisInput,
  type FileChange,
  type FileChangeKind,
  type PathClass,
  type PathClassification,
  type StoredEvent,
} from '@stillwatch/schema';
import type { AccessRecord, PathChange, RuleContext, SnapshotChange } from './context';
import { createdFile, pushUnique } from './text';

const WRITE_OPS = new Set(['write', 'delete', 'chmod']);
const GIT_CONFIG_SUBCOMMANDS = new Set([
  'config',
  'remote',
  'branch',
  'push',
  'checkout',
  'switch',
  'submodule',
  'worktree',
  'init',
  'clone',
  'lfs',
]);

/** Repository roots the start and end snapshots compared, as path keys. */
export function snapshottedRoots(input: AnalysisInput): string[] {
  if (input.diff === null) return [];
  const roots: string[] = [];
  for (const snap of [input.start, input.end]) {
    for (const repo of snap?.repos ?? []) pushUnique(roots, pathKey(repo.root));
  }
  return roots;
}

/** Commands that change some file classes as a side effect, without naming the file. */
type Explainers = Partial<Record<PathClass, StoredEvent[]>>;

function collectExplainers(counted: RuleContext['counted']): Explainers {
  const out: Explainers = {};
  const add = (cls: PathClass, event: StoredEvent): void => {
    const list = (out[cls] ??= []);
    if (!list.includes(event)) list.push(event);
  };
  for (const { event, effective } of counted) {
    if (!effective) continue;
    if (event.facts.packages.length > 0) add('package_manifest', event);
    for (const s of event.facts.signals) {
      if (s.kind === 'scheduled_task' && s.source === 'tool.input') add('scheduled_task', event);
    }
    for (const c of event.facts.commands) {
      const sub = c.args.find((a) => !a.startsWith('-'));
      if (c.program === 'git' && sub !== undefined && GIT_CONFIG_SUBCOMMANDS.has(sub)) {
        add('git_config', event);
      }
      if (c.program === 'claude' && (sub === 'mcp' || sub === 'config' || sub === 'plugin')) {
        add('agent_config', event);
      }
    }
  }
  return out;
}

/** Explaining events for a change with no direct write, or an empty list. */
function implied(change: PathChange, explainers: Explainers): StoredEvent[] {
  const out: StoredEvent[] = [];
  for (const cls of change.classes) {
    for (const event of explainers[cls] ?? []) {
      if (cls === 'package_manifest') {
        const cwd = event.cwd;
        const repo = change.diff?.repoRoot ?? null;
        const near =
          cwd !== null && (isWithin(change.path, cwd) || (repo !== null && isWithin(cwd, repo)));
        if (!near) continue;
      }
      if (!out.includes(event)) out.push(event);
    }
  }
  return out;
}

/** Builds one PathChange per changed path key, with attribution. */
export function buildPathChanges(
  input: AnalysisInput,
  accesses: readonly AccessRecord[],
  counted: RuleContext['counted'],
  classOf: (path: string) => PathClassification,
): PathChange[] {
  const byKey = new Map<string, PathChange>();
  const roots = snapshottedRoots(input);
  const get = (path: string): PathChange => {
    const key = pathKey(path);
    let change = byKey.get(key);
    if (change === undefined) {
      const c = classOf(path);
      change = {
        path,
        key,
        classes: [...c.classes],
        label: c.label,
        writes: [],
        diff: null,
        surface: null,
        inSnapshottedRepo: roots.some((r) => isWithin(key, r)),
        attribution: 'unattributed',
        attributionEventIds: [],
      };
      byKey.set(key, change);
    }
    return change;
  };

  for (const record of accesses) {
    if (!record.effective || !WRITE_OPS.has(record.access.op)) continue;
    get(record.access.path).writes.push(record);
  }
  for (const file of input.diff?.files ?? []) get(file.path).diff = file;
  for (const s of input.diff?.surface ?? []) {
    const children = s.kind === 'dir' ? (s.childChanges ?? []) : [];
    const targets =
      children.length > 0
        ? children.map((child) => ({
            path: joinPath(s.path, child.name),
            change: child.change,
            hashAfter: childHash(input, s.path, child.name),
            kind: 'file' as const,
          }))
        : [{ path: s.path, change: s.change, hashAfter: s.hashAfter, kind: s.kind }];
    for (const t of targets) {
      const change = get(t.path);
      const surface: SnapshotChange = {
        change: t.change,
        kind: t.kind,
        hashAfter: t.hashAfter,
        label: s.label,
      };
      change.surface = surface;
      pushUnique(change.classes, s.class);
      change.label ??= s.label;
    }
  }

  const explainers = collectExplainers(counted);
  const otherWrites = new Set<string>();
  for (const o of input.prior.overlapping) for (const w of o.writes) otherWrites.add(pathKey(w));

  for (const change of byKey.values()) {
    const tool = change.writes.filter((w) => w.access.via === 'tool');
    const shell = change.writes.filter((w) => w.access.via !== 'tool');
    const explained = change.writes.length === 0 ? implied(change, explainers) : [];
    if (tool.length > 0) {
      change.attribution = 'tool';
      change.attributionEventIds = uniqueIds(tool.map((w) => w.event));
    } else if (shell.length > 0 || explained.length > 0) {
      change.attribution = 'shell';
      change.attributionEventIds = uniqueIds([...shell.map((w) => w.event), ...explained]);
    } else if (otherWrites.has(change.key)) {
      change.attribution = 'other_session';
    }
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function childHash(input: AnalysisInput, dir: string, name: string): string | null {
  const entry = input.end?.surface.find((e) => pathKey(e.path) === pathKey(dir));
  const hash = entry?.children?.[name];
  return hash === undefined || hash === 'dir' ? null : hash;
}

function uniqueIds(events: readonly StoredEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) pushUnique(out, e.id);
  return out;
}

/** Change kind of a path from its writes alone. */
export function writeChangeKind(change: PathChange): FileChangeKind {
  const last = change.writes[change.writes.length - 1];
  if (last?.access.op === 'delete') return 'deleted';
  const created = change.writes.some(
    (w) => w.access.via === 'tool' && w.event.tool !== null && createdFile(w.event.tool),
  );
  return created ? 'added' : 'modified';
}

/**
 * File changes for the report: every file in the snapshot diff, plus tool and
 * shell writes outside every snapshotted repository.
 */
export function buildFileChanges(
  input: AnalysisInput,
  changes: readonly PathChange[],
): FileChange[] {
  const out: FileChange[] = [];
  const sessionId = input.session.id;
  const projectRoot = input.session.projectRoot;
  for (const change of changes) {
    const base = {
      sessionId,
      path: change.path,
      classes: change.classes,
      attribution: change.attribution,
      eventIds: change.attributionEventIds,
    };
    if (change.diff !== null) {
      const d = change.diff;
      out.push({
        ...base,
        repoRoot: d.repoRoot,
        relPath: d.relPath,
        change: d.change,
        oldPath: d.oldPath,
        additions: d.additions,
        deletions: d.deletions,
        binary: d.binary,
        committed: d.committed,
      });
    } else if (change.writes.length > 0 && !change.inSnapshottedRepo) {
      const inProject = projectRoot !== null && isWithin(change.path, projectRoot);
      out.push({
        ...base,
        repoRoot: inProject ? projectRoot : null,
        relPath: inProject ? relativeTo(change.path, projectRoot) : null,
        change: writeChangeKind(change),
        oldPath: null,
        additions: null,
        deletions: null,
        binary: false,
        committed: false,
      });
    }
  }
  return out;
}

/** Comparison of persistence surface entries between two snapshots. */
import { type SurfaceChange, type SurfaceEntry } from '@stillwatch/schema';

type ChildChange = NonNullable<SurfaceChange['childChanges']>[number];

function childChanges(
  start: Record<string, string> | null,
  end: Record<string, string> | null,
): ChildChange[] | null {
  if (start === null && end === null) return null;
  const before = start ?? {};
  const after = end ?? {};
  const changes: ChildChange[] = [];
  for (const name of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const was = before[name];
    const is = after[name];
    if (was === undefined && is !== undefined) changes.push({ name, change: 'created' });
    else if (was !== undefined && is === undefined) changes.push({ name, change: 'deleted' });
    else if (was !== is) changes.push({ name, change: 'modified' });
  }
  return changes;
}

/**
 * Compares entries by path. An entry missing from one snapshot counts as not
 * existing there. Entries with an error on either side are reported in `errors`
 * instead, since their state is unknown.
 */
export function diffSurface(
  start: SurfaceEntry[],
  end: SurfaceEntry[],
): { changes: SurfaceChange[]; errors: string[] } {
  const before = new Map(start.map((entry) => [entry.path, entry]));
  const after = new Map(end.map((entry) => [entry.path, entry]));
  const changes: SurfaceChange[] = [];
  const errors: string[] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const was = before.get(path);
    const is = after.get(path);
    const entry = is ?? was;
    if (entry === undefined) continue;
    const failed = [was, is].find((side) => side !== undefined && side.error !== null);
    if (failed !== undefined) {
      errors.push(`surface ${path}: ${failed.error ?? 'unreadable'}`);
      continue;
    }
    const existed = was?.exists ?? false;
    const exists = is?.exists ?? false;
    let change: SurfaceChange['change'] | null = null;
    if (!existed && exists) change = 'created';
    else if (existed && !exists) change = 'deleted';
    else if (existed && exists && (was?.hash !== is?.hash || was?.mode !== is?.mode)) {
      change = 'modified';
    }
    if (change === null) continue;
    const children = childChanges(
      existed ? (was?.children ?? null) : null,
      exists ? (is?.children ?? null) : null,
    );
    changes.push({
      path,
      class: entry.class,
      label: entry.label,
      kind: entry.kind,
      change,
      childChanges: children,
      hashAfter: is?.exists === true ? is.hash : null,
    });
  }
  return { changes, errors };
}

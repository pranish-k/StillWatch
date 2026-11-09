/** Path class groupings used across rules, attribution, and artifacts. */
import type { ArtifactKind, PathClass } from '@stillwatch/schema';

/** Classes whose changes outlive the session and can run or steer later work. */
export const PERSISTENCE_CLASSES: readonly PathClass[] = [
  'stillwatch',
  'git_hook',
  'git_config',
  'ci',
  'task_runner',
  'scheduled_task',
  'startup_file',
  'agent_config',
  'memory_note',
];

/** Artifact kind for a set of classes, most specific first; null when not an artifact. */
export function artifactKindOf(classes: readonly PathClass[]): ArtifactKind | null {
  const order: readonly (PathClass & ArtifactKind)[] = [
    'stillwatch',
    'git_hook',
    'scheduled_task',
    'startup_file',
    'agent_config',
    'ci',
    'git_config',
    'task_runner',
    'memory_note',
    'package_manifest',
  ];
  for (const kind of order) if (classes.includes(kind)) return kind;
  return null;
}

export function isPersistenceClass(classes: readonly PathClass[]): boolean {
  return classes.some((c) => PERSISTENCE_CLASSES.includes(c));
}

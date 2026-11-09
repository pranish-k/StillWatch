/**
 * Artifacts: what remains after the session and could run or be read later.
 * Persistence-class path changes, running background tasks, recurring
 * session crons, and scheduled tasks created by commands.
 */
import {
  ARTIFACT_KINDS,
  pathKey,
  type AnalysisInput,
  type Artifact,
  type ArtifactKind,
} from '@stillwatch/schema';
import { writeChangeKind } from './attribution';
import { artifactKindOf } from './classes';
import type { PathChange, RuleContext } from './context';
import { stableId } from './ids';
import { firstLine, pushUnique } from './text';

/** Deterministic artifact id from session, kind, and path. */
export function artifactId(sessionId: string, kind: ArtifactKind, path: string): string {
  return stableId(sessionId, kind, path);
}

/** True for a background task status that means it is still running. */
export function isRunning(status: string | null): boolean {
  return status === null || /^(?:running|pending|in_progress|started|active)$/i.test(status);
}

function overlayHash(input: AnalysisInput, change: PathChange): string | null {
  const d = change.diff;
  if (d === null || d.change === 'deleted') return null;
  const repo = input.end?.repos.find((r) => pathKey(r.root) === pathKey(d.repoRoot));
  return repo?.overlay[d.relPath] ?? null;
}

function pathArtifact(input: AnalysisInput, change: PathChange, kind: ArtifactKind): Artifact {
  let state: Artifact['change'];
  if (change.surface !== null) state = change.surface.change;
  else if (change.diff !== null) {
    state =
      change.diff.change === 'added'
        ? 'created'
        : change.diff.change === 'deleted'
          ? 'deleted'
          : 'modified';
  } else {
    const k = writeChangeKind(change);
    state = k === 'added' ? 'created' : k === 'deleted' ? 'deleted' : 'modified';
  }
  const snapshot = change.diff !== null || change.surface !== null;
  const eventIds: string[] = [];
  for (const w of change.writes) pushUnique(eventIds, w.event.id);
  for (const id of change.attributionEventIds) pushUnique(eventIds, id);
  return {
    id: artifactId(input.session.id, kind, change.path),
    sessionId: input.session.id,
    kind,
    path: change.path,
    change: state,
    hashAfter: change.surface?.hashAfter ?? overlayHash(input, change),
    source: snapshot
      ? 'snapshot'
      : change.writes.some((w) => w.access.via === 'tool')
        ? 'tool'
        : 'shell',
    eventIds,
    detail: change.label,
  };
}

/** Builds the artifact list, ordered by kind and path. */
export function buildArtifacts(
  ctx: Pick<RuleContext, 'input' | 'pathChanges' | 'lastTurnStop' | 'counted'>,
): Artifact[] {
  const { input } = ctx;
  const sessionId = input.session.id;
  const out: Artifact[] = [];
  for (const change of ctx.pathChanges) {
    const kind = artifactKindOf(change.classes);
    if (kind !== null) out.push(pathArtifact(input, change, kind));
  }
  const stop = ctx.lastTurnStop;
  if (stop !== null) {
    for (const task of stop.data.backgroundTasks) {
      if (!isRunning(task.status)) continue;
      const path = task.command ?? task.description ?? task.id;
      out.push({
        id: artifactId(sessionId, 'background_process', `${task.id}\n${path}`),
        sessionId,
        kind: 'background_process',
        path,
        change: 'running',
        hashAfter: null,
        source: 'hook',
        eventIds: [stop.id],
        detail: task.description ?? task.type,
      });
    }
    for (const cron of stop.data.sessionCrons) {
      if (cron.recurring !== true) continue;
      const path = `cron ${cron.schedule ?? cron.id}`;
      out.push({
        id: artifactId(sessionId, 'session_cron', `${cron.id}\n${path}`),
        sessionId,
        kind: 'session_cron',
        path,
        change: 'scheduled',
        hashAfter: null,
        source: 'hook',
        eventIds: [stop.id],
        detail: cron.prompt === null ? null : firstLine(cron.prompt),
      });
    }
  }
  // A scheduled task created by a command, when no snapshot saw the result.
  if (!out.some((a) => a.kind === 'scheduled_task')) {
    for (const { event, effective } of ctx.counted) {
      if (!effective) continue;
      const signal = event.facts.signals.find(
        (s) => s.kind === 'scheduled_task' && s.source === 'tool.input',
      );
      if (signal === undefined) continue;
      const path = firstLine(event.tool?.command ?? signal.detail, 200);
      if (out.some((a) => a.kind === 'scheduled_task' && a.path === path)) continue;
      out.push({
        id: artifactId(sessionId, 'scheduled_task', path),
        sessionId,
        kind: 'scheduled_task',
        path,
        change: 'created',
        hashAfter: null,
        source: 'shell',
        eventIds: [event.id],
        detail: signal.detail,
      });
    }
  }
  const rank = (k: ArtifactKind): number => ARTIFACT_KINDS.indexOf(k);
  return out.sort(
    (a, b) => rank(a.kind) - rank(b.kind) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}

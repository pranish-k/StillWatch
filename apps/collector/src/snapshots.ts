/**
 * Start, end, and live ("current") snapshots of a session (ADR-021).
 *
 * The surface list used for a session's start snapshot is kept in memory so
 * its end snapshot covers exactly the same entries. After a collector restart
 * the list is rebuilt and limited to the paths the start snapshot recorded.
 */
import {
  isKind,
  type RepoSurfaceSpec,
  type SessionSnapshot,
  type StoredEvent,
  type SurfaceSpec,
} from '@stillwatch/schema';
import { recordGap, type PipelineContext } from './context';
import { describeError } from './fs-safe';

type Surfaces = { surface: SurfaceSpec[]; repoSurface: RepoSurfaceSpec[] };
type SessionState = {
  surfaces: Surfaces | null;
  current: { snapshot: SessionSnapshot; at: number } | null;
};

/** Directories added with /add-dir during the session, in order, without duplicates. */
export function extraDirsFrom(events: readonly StoredEvent[]): string[] {
  const dirs = new Set<string>();
  for (const event of events) {
    if (isKind(event, 'directory.add') && event.data.directory !== '') {
      dirs.add(event.data.directory);
    }
  }
  return [...dirs];
}

export class SnapshotManager {
  private readonly sessions = new Map<string, SessionState>();

  private readonly ctx: PipelineContext;

  constructor(ctx: PipelineContext) {
    this.ctx = ctx;
  }

  private state(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { surfaces: null, current: null };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  private surfacesFor(sessionId: string): Surfaces {
    const state = this.state(sessionId);
    if (state.surfaces) return state.surfaces;
    const { deps } = this.ctx;
    let surface = deps.persistenceSurface({
      home: this.ctx.userHome,
      stillwatchHome: this.ctx.stillwatchHome,
      includeSystem: this.ctx.includeSystemSurface,
      platform: this.ctx.platform,
    });
    const start = this.ctx.store.getSnapshot(sessionId, 'start');
    if (start) {
      const recorded = new Set(start.surface.map((entry) => entry.path));
      surface = surface.filter((spec) => recorded.has(spec.path));
    }
    state.surfaces = { surface, repoSurface: deps.repoSurfaceSpecs() };
    return state.surfaces;
  }

  private async take(
    sessionId: string,
    kind: SessionSnapshot['kind'],
    cwd: string,
    extraDirs: string[],
    late: boolean,
  ): Promise<SessionSnapshot | null> {
    try {
      const { surface, repoSurface } = this.surfacesFor(sessionId);
      return await this.ctx.deps.takeSnapshot({
        sessionId,
        kind,
        cwd,
        extraDirs,
        surface,
        repoSurface,
        late,
        now: this.ctx.now,
        ...(this.ctx.gitBinary !== undefined ? { gitBinary: this.ctx.gitBinary } : {}),
      });
    } catch (err) {
      this.ctx.logger.error('snapshot failed', { kind, error: describeError(err) });
      if (kind !== 'current') {
        recordGap(this.ctx, {
          sessionId,
          source: 'snapshot',
          severity: 'warning',
          reason: `The ${kind} snapshot failed, so ${kind} state is unknown`,
        });
      }
      return null;
    }
  }

  /**
   * Called when a session's first event is imported. Takes and stores the
   * start snapshot when that event is fresh; otherwise records that the start
   * state is unknown. Returns true when a snapshot was stored.
   */
  async onFirstEvent(
    sessionId: string,
    firstEventTs: number,
    cwd: string | null,
  ): Promise<boolean> {
    const age = this.ctx.now() - firstEventTs;
    if (age > this.ctx.timing.snapshotFreshMs) {
      recordGap(this.ctx, {
        sessionId,
        source: 'snapshot',
        severity: 'warning',
        reason: 'Start state unknown: the session was first seen too late for a start snapshot',
        startedAt: firstEventTs,
      });
      return false;
    }
    if (cwd === null) {
      recordGap(this.ctx, {
        sessionId,
        source: 'snapshot',
        severity: 'warning',
        reason: 'Start state unknown: the session reported no working directory',
        startedAt: firstEventTs,
      });
      return false;
    }
    const snapshot = await this.take(sessionId, 'start', cwd, [], false);
    if (!snapshot) return false;
    return this.save(snapshot);
  }

  /** Takes and stores the end snapshot. `late` marks one taken after the session ended. */
  async takeEnd(sessionId: string, late: boolean): Promise<boolean> {
    const session = this.ctx.store.getSession(sessionId);
    if (!session) return false;
    if (session.cwd === null) {
      recordGap(this.ctx, {
        sessionId,
        source: 'snapshot',
        severity: 'warning',
        reason: 'End state unknown: the session reported no working directory',
      });
      return false;
    }
    const extraDirs = extraDirsFrom(this.ctx.store.getSessionEvents(sessionId));
    const snapshot = await this.take(sessionId, 'end', session.cwd, extraDirs, late);
    if (!snapshot) return false;
    const saved = this.save(snapshot);
    if (saved && late) {
      recordGap(this.ctx, {
        sessionId,
        source: 'snapshot',
        severity: 'info',
        reason: 'The end snapshot was taken after the session ended',
        endedAt: session.endedAt ?? session.lastEventAt,
      });
    }
    this.state(sessionId).current = null;
    return saved;
  }

  /**
   * A live snapshot of an active session for analysis, not stored. A new one
   * is taken at most every `liveDiffMinIntervalMs`; otherwise the last one is reused.
   */
  async current(
    sessionId: string,
    cwd: string,
    events: StoredEvent[],
  ): Promise<SessionSnapshot | null> {
    const state = this.state(sessionId);
    const now = this.ctx.now();
    if (state.current && now - state.current.at < this.ctx.timing.liveDiffMinIntervalMs) {
      return state.current.snapshot;
    }
    const snapshot = await this.take(sessionId, 'current', cwd, extraDirsFrom(events), false);
    if (snapshot) state.current = { snapshot, at: now };
    return snapshot ?? state.current?.snapshot ?? null;
  }

  private save(snapshot: SessionSnapshot): boolean {
    try {
      this.ctx.store.saveSnapshot(snapshot);
      return true;
    } catch (err) {
      this.ctx.logger.error('saving snapshot failed', {
        kind: snapshot.kind,
        error: describeError(err),
      });
      return false;
    }
  }

  /** Drops in-memory state for a session (deleted, or no longer active). */
  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Session ids with in-memory state, for pruning. */
  tracked(): string[] {
    return [...this.sessions.keys()];
  }
}

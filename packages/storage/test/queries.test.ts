import type {
  Artifact,
  CaptureGap,
  FileChange,
  RiskLevel,
  SessionListQuery,
  SessionSnapshot,
  SessionStatus,
} from '@stillwatch/schema';
import { describe, expect, it } from 'vitest';
import { InvalidCursorError, type Store } from '../src/index';
import { loadSqlite } from '../src/sqlite';
import { emptyResult, ev, finding, item, meta, openTemp } from './helpers';

const query = (q: Partial<SessionListQuery> = {}): SessionListQuery => ({
  risk: null,
  status: null,
  q: null,
  projectId: null,
  sort: 'review',
  limit: 50,
  cursor: null,
  ...q,
});

function addSession(
  store: Store,
  id: string,
  ts: number,
  opts: {
    risk?: RiskLevel;
    status?: SessionStatus;
    title?: string;
    root?: string;
    summary?: string;
  } = {},
): number {
  store.insertEvents([
    item(
      ev(
        'session.start',
        { source: null, model: null, sessionTitle: opts.title ?? null },
        { sessionId: id, ts },
      ),
      opts.root ?? null,
    ),
  ]);
  const maxSeq = store.pendingAnalysis().find((p) => p.sessionId === id)?.maxSeq ?? 0;
  store.saveAnalysis(
    id,
    emptyResult({ risk: opts.risk ?? 'low' }),
    meta(maxSeq, { status: opts.status ?? 'active', summary: opts.summary ?? `summary ${id}` }),
  );
  return maxSeq;
}

function fileChange(
  sessionId: string,
  path: string,
  overrides: Partial<FileChange> = {},
): FileChange {
  return {
    sessionId,
    path,
    repoRoot: null,
    relPath: null,
    change: 'modified',
    oldPath: null,
    additions: 1,
    deletions: 0,
    binary: false,
    classes: [],
    attribution: 'tool',
    eventIds: [],
    committed: false,
    ...overrides,
  };
}

function artifact(sessionId: string, path: string, eventIds: string[]): Artifact {
  return {
    id: `a-${sessionId}-${path}`,
    sessionId,
    kind: 'memory_note',
    path,
    change: 'modified',
    hashAfter: null,
    source: 'tool',
    eventIds,
    detail: null,
  };
}

function gap(
  id: string,
  sessionId: string | null,
  createdAt: number,
  source: CaptureGap['source'] = 'spool',
): CaptureGap {
  return {
    id,
    sessionId,
    source,
    severity: 'warning',
    startedAt: null,
    endedAt: null,
    reason: 'r',
    createdAt,
  };
}

describe('listSessions', () => {
  it('orders by review priority, then newest, and paginates across ties without gaps or duplicates', () => {
    const store = openTemp();
    const risks: RiskLevel[] = ['low', 'high', 'unknown', 'medium'];
    for (let i = 0; i < 40; i++) {
      // Many sessions share the same lastEventAt to exercise tie-breaking by id.
      addSession(store, `s${String(i).padStart(2, '0')}`, 1000 + (i % 3), {
        risk: risks[i % 4] ?? 'low',
      });
    }
    const all = store.listSessions(query({ limit: 200 }));
    expect(all.total).toBe(40);
    const order: Record<RiskLevel, number> = { high: 0, medium: 1, unknown: 2, low: 3 };
    for (let i = 1; i < all.sessions.length; i++) {
      const a = all.sessions[i - 1]!;
      const b = all.sessions[i]!;
      const key = (s: typeof a) => [order[s.risk], -s.lastEventAt];
      const [ra, ta] = key(a);
      const [rb, tb] = key(b);
      expect(ra! < rb! || (ra === rb && (ta! < tb! || (ta === tb && a.id > b.id)))).toBe(true);
    }
    for (const sort of ['review', 'recent'] as const) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page = store.listSessions(query({ sort, limit: 7, cursor }));
        expect(page.total).toBe(40);
        seen.push(...page.sessions.map((s) => s.id));
        cursor = page.nextCursor;
      } while (cursor !== null);
      expect(seen).toHaveLength(40);
      expect(new Set(seen).size).toBe(40);
      if (sort === 'review') expect(seen).toEqual(all.sessions.map((s) => s.id));
    }
    const recent = store.listSessions(query({ sort: 'recent', limit: 3 }));
    expect(recent.sessions.map((s) => s.lastEventAt)).toEqual([1002, 1002, 1002]);
  });

  it('filters by risk, status, project, and text with escaped wildcards', () => {
    const store = openTemp();
    addSession(store, 'a', 1, { risk: 'high', title: 'Deploy 100% safely', root: '/w/alpha' });
    addSession(store, 'b', 2, {
      risk: 'low',
      status: 'finished',
      title: 'Write docs',
      root: '/w/beta',
    });
    addSession(store, 'c', 3, {
      risk: 'medium',
      title: 'snake_case rename',
      summary: 'Touched CI',
    });
    const ids = (q: Partial<SessionListQuery>) =>
      store.listSessions(query(q)).sessions.map((s) => s.id);
    expect(ids({ risk: ['high', 'medium'] })).toEqual(['a', 'c']);
    expect(ids({ status: ['finished'] })).toEqual(['b']);
    const beta = store.getSession('b')!.projectId;
    expect(ids({ projectId: beta })).toEqual(['b']);
    expect(ids({ q: '100%' })).toEqual(['a']);
    expect(ids({ q: '%' })).toEqual(['a']);
    expect(ids({ q: '_' })).toEqual(['c']);
    expect(ids({ q: 'ci' })).toEqual(['c']);
    expect(ids({ q: 'ALPHA' })).toEqual(['a']);
    expect(ids({ q: '  ' })).toHaveLength(3);
    expect(store.listSessions(query({ risk: ['low'], q: 'docs' })).total).toBe(1);
  });

  it('clamps the limit and rejects foreign cursors', () => {
    const store = openTemp();
    for (let i = 0; i < 3; i++) addSession(store, `s${String(i)}`, i);
    expect(store.listSessions(query({ limit: 0 })).sessions).toHaveLength(1);
    expect(store.listSessions(query({ limit: 10_000 })).sessions).toHaveLength(3);
    const page = store.listSessions(query({ limit: 1 }));
    expect(() => store.listSessions(query({ sort: 'recent', cursor: page.nextCursor }))).toThrow(
      InvalidCursorError,
    );
    expect(() => store.listSessions(query({ cursor: 'garbage!' }))).toThrow(InvalidCursorError);
  });

  it('includes top findings and gap counts', () => {
    const store = openTemp();
    const seq = addSession(store, 's', 1);
    store.saveAnalysis(
      's',
      emptyResult({
        risk: 'high',
        findings: [
          finding('s', 'f1', 'low'),
          finding('s', 'f2', 'high'),
          finding('s', 'f3', 'medium'),
          finding('s', 'f4', 'medium'),
        ],
      }),
      meta(seq),
    );
    store.addGap(gap('g1', 's', 5));
    store.addGap(gap('g2', 's', 6));
    const [summary] = store.listSessions(query()).sessions;
    expect(summary?.topFindings.map((f) => f.severity)).toEqual(['high', 'medium', 'medium']);
    expect(summary?.findingCount).toBe(4);
    expect(summary?.gapCount).toBe(2);
  });
});

describe('analysis storage', () => {
  it('replaces derived rows and keeps capture gaps', () => {
    const store = openTemp();
    const seq = addSession(store, 's', 1);
    store.addGap(gap('capture', 's', 1, 'snapshot'));
    store.saveAnalysis(
      's',
      emptyResult({
        findings: [finding('s', 'f1', 'high', ['e1'])],
        fileChanges: [fileChange('s', '/r/a.ts')],
        domains: [
          { sessionId: 's', domain: 'a.com', firstEventId: 'e', count: 1, isNew: true, via: [] },
        ],
        gaps: [gap('an1', 's', 2, 'analysis')],
        unfinished: [{ kind: 'turn', label: 'x', eventId: null }],
        lastAssistantMessage: 'done',
        risk: 'high',
        riskReasons: ['because'],
      }),
      meta(seq, { status: 'finished', endReason: 'no_session_end' }),
    );
    let detail = store.getSessionDetail('s')!;
    expect(detail.findings.map((f) => f.id)).toEqual(['f1']);
    expect(detail.session).toMatchObject({
      risk: 'high',
      riskReasons: ['because'],
      status: 'finished',
      endReason: 'no_session_end',
      endedAt: 1,
    });
    expect(detail.unfinished).toHaveLength(1);
    expect(detail.lastAssistantMessage).toBe('done');
    expect(detail.gaps.map((g) => g.id)).toEqual(['capture', 'an1']);
    expect(store.findingIdsByEvent('s')).toEqual({ e1: ['f1'] });

    store.saveAnalysis('s', emptyResult({ gaps: [gap('an2', 's', 3, 'snapshot')] }), meta(seq));
    detail = store.getSessionDetail('s')!;
    expect(detail.findings).toEqual([]);
    expect(detail.fileChanges).toEqual([]);
    expect(detail.domains).toEqual([]);
    expect(detail.gaps.map((g) => g.id)).toEqual(['capture', 'an2']);
    expect(detail.session.status).toBe('active');
    expect(store.getGaps('s', { excludeSource: 'analysis' }).map((g) => g.id)).toEqual(['capture']);
  });

  it('keeps the ingest status when the analysis is stale and ignores unknown sessions', () => {
    const store = openTemp();
    const seq = addSession(store, 's', 1);
    store.insertEvents([
      item(
        ev(
          'prompt.submit',
          { prompt: 'p', origin: 'user', sessionTitle: null },
          { sessionId: 's', ts: 2 },
        ),
      ),
    ]);
    store.saveAnalysis('s', emptyResult(), meta(seq, { status: 'finished' }));
    expect(store.getSession('s')?.status).toBe('active');
    expect(store.pendingAnalysis().map((p) => p.sessionId)).toEqual(['s']);
    expect(() => {
      store.saveAnalysis('missing', emptyResult(), meta(1));
    }).not.toThrow();
  });

  it('builds prior context from other sessions', () => {
    const store = openTemp();
    addSession(store, 'old', 100);
    store.insertEvents([
      item(
        ev(
          'notification',
          { notificationType: null, title: null, message: null },
          { sessionId: 'old', id: 'old-w', ts: 150 },
        ),
      ),
    ]);
    store.saveAnalysis(
      'old',
      emptyResult({
        domains: [
          {
            sessionId: 'old',
            domain: 'known.com',
            firstEventId: 'x',
            count: 1,
            isNew: true,
            via: [],
          },
        ],
        artifacts: [artifact('old', '/private/tmp/r/CLAUDE.md', ['old-w'])],
        fileChanges: [
          fileChange('old', '/home/u/.claude/settings.json', { classes: ['agent_config'] }),
        ],
      }),
      meta(99),
    );
    addSession(store, 'peer', 200);
    store.insertEvents([
      item(
        ev(
          'notification',
          { notificationType: null, title: null, message: null },
          { sessionId: 'peer', ts: 400 },
        ),
      ),
    ]);
    store.saveAnalysis(
      'peer',
      emptyResult({
        fileChanges: [
          fileChange('peer', '/r/a.ts'),
          fileChange('peer', '/r/b.ts', { attribution: 'unattributed' }),
          fileChange('peer', '/r/c.ts', { attribution: 'shell' }),
        ],
        domains: [
          {
            sessionId: 'peer',
            domain: 'later.com',
            firstEventId: 'x',
            count: 1,
            isNew: true,
            via: [],
          },
        ],
      }),
      meta(99),
    );
    addSession(store, 'me', 300);
    store.insertEvents([
      item(
        ev(
          'notification',
          { notificationType: null, title: null, message: null },
          { sessionId: 'me', ts: 500 },
        ),
      ),
    ]);

    const prior = store.getPriorContext('me');
    expect(prior.knownDomains).toEqual(['known.com', 'later.com']);
    expect(prior.noteWriters).toEqual({
      '/tmp/r/CLAUDE.md': [{ sessionId: 'old', at: 150 }],
      '/home/u/.claude/settings.json': [{ sessionId: 'old', at: 150 }],
    });
    expect(prior.overlapping).toEqual([
      { sessionId: 'peer', startedAt: 200, lastEventAt: 400, writes: ['/r/a.ts', '/r/c.ts'] },
    ]);
    expect(store.getPriorContext('old').knownDomains).toEqual([]);
    expect(store.getPriorContext('nope')).toEqual({
      knownDomains: [],
      noteWriters: {},
      overlapping: [],
    });
  });
});

describe('detail, links, and deletion', () => {
  function linked(store: Store) {
    addSession(store, 'writer', 100, { title: 'Writer' });
    const seq = addSession(store, 'reader', 200, { title: 'Reader' });
    store.saveAnalysis(
      'reader',
      emptyResult({
        links: [
          {
            sourceSessionId: 'writer',
            targetSessionId: 'reader',
            path: '/r/CLAUDE.md',
            kind: 'note_loaded',
            eventId: null,
            at: 201,
          },
          {
            sourceSessionId: 'gone',
            targetSessionId: 'reader',
            path: '/r/x.md',
            kind: 'note_read',
            eventId: null,
            at: 202,
          },
        ],
      }),
      meta(seq),
    );
  }

  it('shows links in both directions', () => {
    const store = openTemp();
    linked(store);
    expect(store.getSessionDetail('reader')?.links).toEqual([
      expect.objectContaining({
        sourceSessionId: 'writer',
        direction: 'incoming',
        otherSessionTitle: 'Writer',
      }),
    ]);
    expect(store.getSessionDetail('writer')?.links).toEqual([
      expect.objectContaining({
        targetSessionId: 'reader',
        direction: 'outgoing',
        otherSessionTitle: 'Reader',
      }),
    ]);
    expect(store.getSessionDetail('nope')).toBeNull();
  });

  it('cascades a session delete to every owned row and to links in both directions', () => {
    const store = openTemp();
    linked(store);
    const snap: SessionSnapshot = {
      v: 1,
      kind: 'start',
      sessionId: 'writer',
      takenAt: 1,
      cwd: '/',
      repos: [],
      surface: [],
      durationMs: 1,
      late: false,
    };
    store.saveSnapshot(snap);
    expect(store.getSnapshot('writer', 'start')).toEqual(snap);
    expect(store.getSnapshot('writer', 'end')).toBeNull();
    store.addGap(gap('g', 'writer', 1));
    expect(store.deleteSession('writer')).toBe(true);
    expect(store.deleteSession('writer')).toBe(false);
    expect(store.getSessionDetail('reader')?.links).toEqual([]);
    const db = new (loadSqlite().DatabaseSync)(store.path);
    for (const table of ['events', 'agents', 'snapshots', 'gaps', 'links']) {
      const row = db
        .prepare(
          `SELECT count(*) AS n FROM ${table} WHERE ${table === 'links' ? 'source_session_id' : 'session_id'} = 'writer'`,
        )
        .get();
      expect(row?.n).toBe(0);
    }
    db.close();
    expect(() => {
      store.saveSnapshot({ ...snap, sessionId: 'writer' });
    }).toThrow(/unknown session/);
  });

  it('applies retention by lastEventAt and deletes everything on request', () => {
    const store = openTemp();
    addSession(store, 'old', 100);
    addSession(store, 'new', 500);
    store.addGap(gap('global-old', null, 50));
    store.addGap(gap('global-new', null, 600));
    store.addGap(gap('orphan', 'never-seen', 50));
    expect(store.deleteSessionsBefore(300)).toBe(1);
    expect(store.getSession('old')).toBeNull();
    expect(store.getSession('new')).not.toBeNull();
    expect(store.getGaps(null).map((g) => g.id)).toEqual(['global-new']);
    expect(store.getGaps('never-seen')).toEqual([]);
    store.deleteAll();
    expect(store.counts()).toMatchObject({ sessions: 0, events: 0 });
    expect(store.lastEventAt()).toBeNull();
  });
});

describe('event pages', () => {
  it('pages events in display order with an opaque cursor', () => {
    const store = openTemp();
    const items = Array.from({ length: 25 }, (_, i) =>
      item(
        ev(
          'notification',
          { notificationType: null, title: null, message: String(i) },
          { ts: 1000 + Math.floor(i / 5) },
        ),
      ),
    );
    store.insertEvents(items);
    const all = store.getSessionEvents('s1').map((e) => e.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = store.listEvents('s1', { cursor, limit: 4 });
      seen.push(...page.events.map((e) => e.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(all);
    expect(() => store.listEvents('s1', { cursor: 'x', limit: 4 })).toThrow(InvalidCursorError);
  });
});

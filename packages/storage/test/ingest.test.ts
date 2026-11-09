import { createHash } from 'node:crypto';
import { canonicalJson, emptyFacts, MAIN_AGENT_ID, type JsonObject } from '@stillwatch/schema';
import { describe, expect, it } from 'vitest';
import { loadSqlite } from '../src/sqlite';
import { capText, titleFromPrompt } from '../src/ingest';
import { emptyResult, ev, item, meta, openTemp, tool } from './helpers';

const start = (
  o: Parameters<typeof ev>[2] = {},
  model: string | null = null,
  title: string | null = null,
) => ev('session.start', { source: 'startup', model, sessionTitle: title }, o);
const prompt = (
  text: string,
  o: Parameters<typeof ev>[2] = {},
  origin: 'user' | 'task_notification' = 'user',
) => ev('prompt.submit', { prompt: text, origin, sessionTitle: null }, o);

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('insertEvents', () => {
  it('skips duplicates by source id and counts them', () => {
    const store = openTemp();
    const a = start();
    const b = prompt('hello');
    expect(store.insertEvents([item(a), item(b)])).toEqual({
      inserted: 2,
      duplicates: 0,
      sessionIds: ['s1'],
    });
    const again = store.insertEvents([item({ ...a, id: 'other-id' }), item(b)]);
    expect(again).toEqual({ inserted: 0, duplicates: 2, sessionIds: ['s1'] });
    expect(store.counts().events).toBe(2);
    expect(store.getSession('s1')?.eventCount).toBe(2);
    expect(store.verifyChain('s1')[0]?.ok).toBe(true);
  });

  it('rolls back the whole batch when one event is invalid', () => {
    const store = openTemp();
    const bad = { ...prompt('x'), ts: Number.NaN };
    expect(() => store.insertEvents([item(start()), item(bad)])).toThrow(/finite ts/);
    expect(store.counts().events).toBe(0);
  });

  it('handles batches spanning several sessions', () => {
    const store = openTemp();
    const r = store.insertEvents([
      item(start({ sessionId: 'a' })),
      item(start({ sessionId: 'b' })),
      item(prompt('x', { sessionId: 'a' })),
    ]);
    expect(r.sessionIds.sort()).toEqual(['a', 'b']);
    expect(store.getSession('a')?.eventCount).toBe(2);
  });

  it('sorts a tool result after its call, also when the result arrives first', () => {
    const store = openTemp();
    const pre = ev('tool.pre', {}, { ts: 5000, tool: tool('Bash', 'u1') });
    const post = ev('tool.post', {}, { ts: 4000, tool: tool('Bash', 'u1') });
    const other = ev(
      'notification',
      { notificationType: null, title: null, message: 'm' },
      { ts: 4500 },
    );
    store.insertEvents([item(start({ ts: 1000 })), item(post), item(other)]);
    store.insertEvents([item(pre)]);
    const events = store.getSessionEvents('s1');
    expect(events.map((e) => e.id)).toEqual([events[0]?.id, other.id, pre.id, post.id]);
    const p = events.find((e) => e.id === pre.id)!;
    const r = events.find((e) => e.id === post.id)!;
    expect(r.orderTs).toBeGreaterThanOrEqual(p.orderTs + 0.001);
    expect(r.ts).toBe(4000);

    const pre2 = ev('tool.pre', {}, { ts: 6000, tool: tool('Bash', 'u2') });
    const fail = ev('tool.failure', {}, { ts: 6000, tool: tool('Bash', 'u2') });
    store.insertEvents([item(pre2), item(fail)]);
    const f = store.getEvent(fail.id)!;
    expect(f.orderTs).toBe(6000 + 0.001);
    expect(store.verifyChain('s1')[0]?.ok).toBe(true);
  });

  it('creates the session from any first event and fills fields from later ones', () => {
    const store = openTemp();
    const loaded = ev(
      'instructions.loaded',
      {
        filePath: '/r/CLAUDE.md',
        memoryType: null,
        loadReason: null,
        globs: [],
        triggerFilePath: null,
        parentFilePath: null,
      },
      { ts: 900, cwd: '/r/sub', transcriptPath: '/t/1.jsonl' },
    );
    store.insertEvents([item(loaded, '/r')]);
    let s = store.getSession('s1')!;
    expect(s.startedAt).toBe(900);
    expect(s.cwd).toBe('/r/sub');
    expect(s.projectRoot).toBe('/r');
    expect(s.projectName).toBe('r');
    expect(s.projectId).toBe(sha('/r').slice(0, 16));
    expect(s.risk).toBe('unknown');

    store.insertEvents([
      item(
        start(
          { ts: 1000, cwd: '/r', permissionMode: 'default', transcriptPath: '/t/2.jsonl' },
          'opus',
        ),
        '/other',
      ),
      item(prompt('<task-notification> done', { ts: 1001 }, 'task_notification')),
      item(prompt('\n  Fix the login bug\nmore detail', { ts: 1002, permissionMode: 'plan' })),
      item(prompt('Second prompt', { ts: 1003 })),
      item(
        ev('model.switch', { fromModel: 'opus', toModel: 'sonnet', source: null }, { ts: 1004 }),
      ),
    ]);
    s = store.getSession('s1')!;
    expect(s.cwd).toBe('/r');
    expect(s.projectRoot).toBe('/r');
    expect(s.transcriptPath).toBe('/t/2.jsonl');
    expect(s.title).toBe('Fix the login bug');
    expect(s.model).toBe('sonnet');
    expect(s.permissionMode).toBe('plan');
    expect(s.startedAt).toBe(900);
    expect(s.lastEventAt).toBe(1004);

    store.insertEvents([
      item(
        ev(
          'prompt.submit',
          { prompt: 'x', origin: 'user', sessionTitle: 'My custom title' },
          { ts: 1005 },
        ),
      ),
      item(prompt('Later prompt', { ts: 1006 })),
    ]);
    expect(store.getSession('s1')?.title).toBe('My custom title');
  });

  it('caps titles without splitting surrogate pairs', () => {
    expect(titleFromPrompt('a'.repeat(500))?.length).toBe(120);
    expect(titleFromPrompt('   \n\n')).toBeNull();
    const capped = capText(`${'a'.repeat(118)}\u{1F600}rest`, 120);
    expect(capped).toBe(`${'a'.repeat(118)}…`);
  });

  it('tracks status across end, resume, and interruption', () => {
    const store = openTemp();
    store.insertEvents([
      item(start({ ts: 1000 })),
      item(ev('session.end', { reason: 'logout' }, { ts: 2000 })),
    ]);
    let s = store.getSession('s1')!;
    expect([s.status, s.endedAt, s.endReason]).toEqual(['finished', 2000, 'logout']);

    // A late event from before the end does not reopen the session.
    store.insertEvents([item(ev('tool.post', {}, { ts: 1999, tool: tool('Bash', 'late') }))]);
    expect(store.getSession('s1')?.status).toBe('finished');

    store.insertEvents([item(start({ ts: 3000 }))]);
    s = store.getSession('s1')!;
    expect([s.status, s.endedAt, s.endReason]).toEqual(['active', null, null]);

    store.setSessionStatus('s1', 'interrupted', 'idle', null);
    expect(store.sessionsWithStatus('interrupted').map((x) => x.id)).toEqual(['s1']);
    store.insertEvents([item(prompt('again', { ts: 4000 }))]);
    expect(store.getSession('s1')?.status).toBe('active');
  });

  it('maintains agent rows for the main agent and subagents', () => {
    const store = openTemp();
    store.insertEvents([
      item(start({ ts: 1000, transcriptPath: '/t/main.jsonl' })),
      item(ev('subagent.start', { subagentId: 'sub1', subagentType: 'Explore' }, { ts: 1100 })),
      item(
        ev(
          'tool.pre',
          {},
          { ts: 1200, agentId: 'sub1', agentType: 'Explore', tool: tool('Read', 't1') },
        ),
      ),
      item(
        ev(
          'tool.pre',
          {},
          { ts: 1250, agentId: 'sub2', agentType: 'Plan', tool: tool('Read', 't2') },
        ),
      ),
      item(
        ev(
          'subagent.stop',
          {
            subagentId: 'sub1',
            subagentType: 'Explore',
            transcriptPath: '/t/sub1.jsonl',
            lastMessage: 'found it',
          },
          { ts: 1300, agentId: 'sub1' },
        ),
      ),
      item(
        ev(
          'turn.stop',
          { lastMessage: 'all done', backgroundTasks: [], sessionCrons: [], stopHookActive: null },
          { ts: 1400 },
        ),
      ),
    ]);
    const detail = store.getSessionDetail('s1')!;
    expect(detail.session.subagentCount).toBe(2);
    expect(detail.agents.map((a) => a.agentId)).toEqual([MAIN_AGENT_ID, 'sub1', 'sub2']);
    const [main, sub1, sub2] = detail.agents;
    expect(main).toMatchObject({
      eventCount: 3,
      startedAt: 1000,
      transcriptPath: '/t/main.jsonl',
      lastMessage: 'all done',
    });
    expect(sub1).toMatchObject({
      agentType: 'Explore',
      startedAt: 1100,
      stoppedAt: 1300,
      transcriptPath: '/t/sub1.jsonl',
      lastMessage: 'found it',
      eventCount: 2,
    });
    expect(sub2).toMatchObject({ agentType: 'Plan', startedAt: 1250, eventCount: 1 });
  });

  it('marks sessions for analysis', () => {
    const store = openTemp();
    store.insertEvents([item(start()), item(prompt('x'))]);
    const [pending] = store.pendingAnalysis();
    expect(pending?.sessionId).toBe('s1');
    const seqs = store.getSessionEvents('s1').map((e) => e.seq);
    expect(pending?.maxSeq).toBe(Math.max(...seqs));
    store.saveAnalysis('s1', emptyResult(), meta(pending!.maxSeq));
    expect(store.pendingAnalysis()).toEqual([]);
    store.markForAnalysis('s1');
    expect(store.pendingAnalysis().map((p) => p.sessionId)).toEqual(['s1']);
    expect(store.lastEventAt()).toBe(store.getSession('s1')?.lastEventAt);
  });
});

describe('hash chain', () => {
  it('follows the documented formula', () => {
    const store = openTemp();
    const e = start();
    const facts = { ...emptyFacts(1), domains: ['example.com'] };
    store.insertEvents([{ event: e, facts, redactions: [], projectRoot: null }]);
    const stored = store.getEvent(e.id)!;
    const payload = { ...e, facts, redactions: [] } as unknown as JsonObject;
    const seed = sha('stillwatch:s1');
    expect(stored.hash).toBe(sha(`${seed}\n${canonicalJson(payload)}`));
    expect(store.getSession('s1')?.chainHead).toBe(stored.hash);
  });

  it('detects edits, deletions, and reordering through raw SQL', () => {
    const store = openTemp();
    const events = [start(), prompt('one'), prompt('two'), prompt('three')];
    store.insertEvents(events.map((e) => item(e)));
    store.insertEvents([item(start({ sessionId: 'other' }))]);
    expect(store.verifyChain().every((v) => v.ok)).toBe(true);

    const db = new (loadSqlite().DatabaseSync)(store.path);
    const seqOf = (id: string) =>
      Number(db.prepare('SELECT seq FROM events WHERE id = ?').get(id)?.seq);
    db.prepare("UPDATE events SET event = replace(event, 'two', 'TWO') WHERE id = ?").run(
      events[2]!.id,
    );
    let [result] = store.verifyChain('s1');
    expect(result).toMatchObject({ ok: false, firstBadSeq: seqOf(events[2]!.id) });
    db.prepare("UPDATE events SET event = replace(event, 'TWO', 'two') WHERE id = ?").run(
      events[2]!.id,
    );
    expect(store.verifyChain('s1')[0]?.ok).toBe(true);

    db.prepare('UPDATE events SET ts = ts + 1 WHERE id = ?').run(events[1]!.id);
    [result] = store.verifyChain('s1');
    expect(result).toMatchObject({ ok: false, firstBadSeq: seqOf(events[1]!.id) });
    db.prepare('UPDATE events SET ts = ts - 1 WHERE id = ?').run(events[1]!.id);

    const thirdSeq = seqOf(events[3]!.id);
    db.prepare('DELETE FROM events WHERE id = ?').run(events[2]!.id);
    [result] = store.verifyChain('s1');
    expect(result).toMatchObject({ ok: false, firstBadSeq: thirdSeq });

    db.prepare('DELETE FROM events WHERE id = ?').run(events[3]!.id);
    db.prepare('UPDATE sessions SET event_count = 2 WHERE id = ?').run('s1');
    [result] = store.verifyChain('s1');
    expect(result).toMatchObject({ ok: false, firstBadSeq: null });
    expect(result?.reason).toMatch(/chain head/);
    expect(store.verifyChain('other')[0]?.ok).toBe(true);
    db.close();
  });
});

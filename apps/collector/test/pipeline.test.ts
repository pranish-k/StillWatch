import { open, readdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LIMITS } from '@stillwatch/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_RECORD_ATTEMPTS } from '../src/importer';
import { harness, type Harness } from './fakes';

let h: Harness | null = null;

async function setup(...args: Parameters<typeof harness>): Promise<Harness> {
  h = await harness(...args);
  return h;
}

afterEach(async () => {
  await h?.cleanup();
  h = null;
});

const spoolFiles = (t: Harness) => readdir(join(t.home, 'spool', 'new'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('spool import', () => {
  it('imports oldest first by mtime then name, in batches of 500', async () => {
    const t = await setup();
    const base = t.clock.now - 10_000;
    await t.spool('claude-code.Stop.bbbbbbbb', '{"session_id":"s","hook_event_name":"Stop"}', base);
    await t.spool('claude-code.Stop.aaaaaaaa', '{"session_id":"s","hook_event_name":"Stop"}', base);
    await t.spool('claude-code.Stop.00000000', '{"session_id":"s","hook_event_name":"Stop"}', base + 5);
    await t.spool('claude-code.Stop.zzzzzzzz', '{"session_id":"s","hook_event_name":"Stop"}', base - 5);
    for (let i = 0; i < 497; i++) await t.event('s', 'Notification', base + 100 + i);
    const stats = await t.pipeline.importOnce();
    expect(stats).toMatchObject({ files: 501, imported: 501, duplicates: 0, failed: 0 });
    expect(t.store.insertCalls).toEqual([500, 1]);
    expect(t.store.events.slice(0, 4).map((e) => e.sourceId)).toEqual([
      'claude-code.Stop.zzzzzzzz',
      'claude-code.Stop.aaaaaaaa',
      'claude-code.Stop.bbbbbbbb',
      'claude-code.Stop.00000000',
    ]);
    expect(t.store.events[0]?.ts).toBe(base - 5);
    expect(t.store.getSession('s')?.projectRoot).toBe('/w/repo');
    expect(await spoolFiles(t)).toEqual([]);
  });

  it('is idempotent after a crash between commit and unlink', async () => {
    const t = await setup();
    const paths = [
      await t.event('s', 'SessionStart', t.clock.now - 100),
      await t.event('s', 'Notification', t.clock.now - 50),
    ];
    const bodies = await Promise.all(paths.map((p) => import('node:fs/promises').then((f) => f.readFile(p))));
    await t.pipeline.importOnce();
    for (const [i, p] of paths.entries()) await writeFile(p, bodies[i]!);
    const again = await t.pipeline.importOnce();
    expect(again).toMatchObject({ files: 2, imported: 0, duplicates: 2, failed: 0 });
    expect(t.store.events).toHaveLength(2);
    expect(t.rec.snapshots.filter((s) => s.kind === 'start')).toHaveLength(1);
    expect(await spoolFiles(t)).toEqual([]);
  });

  it('discards bad names, oversized and corrupt records with capture gaps', async () => {
    const t = await setup();
    await t.spool('not a spool name', '{}');
    const big = join(t.home, 'spool', 'new', 'claude-code.PostToolUse.bigbigbig');
    const fh = await open(big, 'w', 0o600);
    await fh.truncate(LIMITS.maxRecordBytes + 1);
    await fh.close();
    await t.spool('claude-code.Stop.corrupt1', '{"session_id":"s9"}');
    await t.spool('claude-code.Stop.corrupt2', '{not json');
    const stats = await t.pipeline.importOnce();
    expect(stats).toMatchObject({ files: 4, imported: 0, failed: 4 });
    expect(await spoolFiles(t)).toEqual([]);
    expect(t.store.getGaps(null)).toHaveLength(3);
    const attributed = t.store.getGaps('s9');
    expect(attributed).toHaveLength(1);
    expect(attributed[0]).toMatchObject({ source: 'spool', severity: 'warning' });
    expect(t.pipeline.failedTotal()).toBe(4);
  });

  it('keeps every record when the store fails, and imports them later', async () => {
    const t = await setup();
    await t.event('s', 'SessionStart', t.clock.now);
    await t.event('s', 'Stop', t.clock.now);
    t.store.failInsert = () => true;
    await expect(t.pipeline.importOnce()).rejects.toThrow(/storing 2 events failed/);
    expect(await spoolFiles(t)).toHaveLength(2);
    t.store.failInsert = null;
    expect(await t.pipeline.importOnce()).toMatchObject({ imported: 2 });
  });

  it('gives up on a record that keeps failing while others import', async () => {
    const t = await setup();
    const poison = await t.event('p', 'Stop', t.clock.now - 1);
    const poisonName = poison.split('/').pop();
    t.store.failInsert = (items) => items.some((i) => i.event.sourceId === poisonName);
    for (let i = 1; i <= MAX_RECORD_ATTEMPTS; i++) {
      await t.event('s', 'Notification', t.clock.now);
      const stats = await t.pipeline.importOnce();
      expect(stats.imported).toBe(1);
      expect(stats.failed).toBe(i === MAX_RECORD_ATTEMPTS ? 1 : 0);
    }
    expect(await spoolFiles(t)).toEqual([]);
    expect(t.store.getGaps('p')).toHaveLength(1);
  });

  it('coalesces concurrent imports', async () => {
    const t = await setup();
    await t.event('s', 'Stop', t.clock.now);
    const runs = await Promise.all([
      t.pipeline.importOnce(),
      t.pipeline.importOnce(),
      t.pipeline.importOnce(),
    ]);
    expect(runs.reduce((n, r) => n + r.imported, 0)).toBe(1);
  });
});

describe('snapshots', () => {
  it('takes a start snapshot for a fresh first event', async () => {
    const t = await setup();
    await t.event('s', 'SessionStart', t.clock.now - 1000);
    const stats = await t.pipeline.importOnce();
    expect(stats.snapshots).toBe(1);
    expect(t.rec.snapshots[0]).toMatchObject({ kind: 'start', cwd: '/w/repo', extraDirs: [] });
    expect(t.rec.snapshots[0]?.surface[0]?.path).toBe(`${t.userHome}/.zshrc`);
    expect(t.store.getSnapshot('s', 'start')).not.toBeNull();
  });

  it('records "start state unknown" for a stale first event', async () => {
    const t = await setup();
    await t.event('s', 'SessionStart', t.clock.now - 60_000);
    await t.pipeline.importOnce();
    expect(t.rec.snapshots).toEqual([]);
    expect(t.store.getGaps('s')[0]).toMatchObject({ source: 'snapshot', severity: 'warning' });
    expect(t.store.getGaps('s')[0]?.reason).toMatch(/Start state unknown/);
  });

  it('takes an end snapshot with the same surface and added directories', async () => {
    const t = await setup();
    await t.event('s', 'SessionStart', t.clock.now - 100);
    await t.pipeline.importOnce();
    await t.event('s', 'DirectoryAdded', t.clock.now - 50, { directory: '/w/other' });
    await t.event('s', 'SessionEnd', t.clock.now - 10);
    const stats = await t.pipeline.importOnce();
    expect(stats.snapshots).toBe(1);
    const [start, end] = t.rec.snapshots;
    expect(end).toMatchObject({ kind: 'end', late: false, extraDirs: ['/w/other'] });
    expect(end?.surface).toBe(start?.surface);
    expect(t.store.getSnapshot('s', 'end')).not.toBeNull();
  });

  it('uses a rate-limited live snapshot for active sessions', async () => {
    const t = await setup();
    await t.event('s', 'SessionStart', t.clock.now);
    await t.pipeline.importOnce();
    await t.pipeline.analyzeSession('s');
    await t.pipeline.analyzeSession('s');
    expect(t.rec.snapshots.filter((s) => s.kind === 'current')).toHaveLength(1);
    t.clock.now += 31_000;
    await t.pipeline.analyzeSession('s');
    expect(t.rec.snapshots.filter((s) => s.kind === 'current')).toHaveLength(2);
    expect(t.store.getSnapshot('s', 'end')).toBeNull();
    expect(t.rec.diffs).toBe(2);
  });
});

describe('analysis', () => {
  it('debounces analysis after imports', async () => {
    const t = await setup({ timing: { analysisDebounceMs: 40 } });
    await t.event('s', 'SessionStart', t.clock.now);
    await t.pipeline.importOnce();
    await t.event('s', 'Stop', t.clock.now);
    await t.pipeline.importOnce();
    expect(t.rec.analyzed).toEqual([]);
    await sleep(150);
    expect(t.rec.analyzed).toEqual(['s']);
    expect(t.store.analyses[0]?.through).toBe(2);
  });

  it('isolates a failing session from the others', async () => {
    const t = await setup();
    await t.event('bad', 'SessionStart', t.clock.now);
    await t.event('good', 'SessionStart', t.clock.now);
    await t.event('good', 'SessionEnd', t.clock.now);
    await t.pipeline.importOnce();
    t.rec.failAnalysis.add('bad');
    expect(await t.pipeline.analyzePending()).toEqual(['good']);
    expect(t.store.analyses).toEqual([
      { sessionId: 'good', through: 3, status: 'finished', summary: 'summary' },
    ]);
    expect(t.store.getGaps('bad').map((g) => g.source)).toContain('collector');
    expect(t.logger.lines.some((l) => l.message === 'session analysis failed')).toBe(true);
    // Retried later, not on every cycle.
    expect(await t.pipeline.analyzePending()).toEqual([]);
    t.rec.failAnalysis.clear();
    t.clock.now += 61_000;
    expect(await t.pipeline.analyzePending()).toEqual(['bad']);
    expect(t.store.getGaps('bad').filter((g) => g.source === 'collector')).toHaveLength(1);
  });
});

describe('sweep', () => {
  it('closes quiet sessions with a late end snapshot, cleans tmp, applies retention', async () => {
    const t = await setup();
    await t.event('s', 'SessionStart', t.clock.now);
    await t.pipeline.importOnce();
    const stale = join(t.home, 'spool', 'tmp', 'claude-code.Stop.abcdefgh');
    await writeFile(stale, 'partial');
    const old = (t.clock.now - 11 * 60_000) / 1000;
    await utimes(stale, old, old);
    const fresh = join(t.home, 'spool', 'tmp', 'claude-code.Stop.freshtmp');
    await writeFile(fresh, 'partial');
    await utimes(fresh, t.clock.now / 1000, t.clock.now / 1000);

    t.clock.now += 25 * 60 * 60_000;
    t.rec.status = () => ({ status: 'finished', endReason: 'no_session_end' });
    await t.pipeline.sweep();

    expect(t.store.statusCalls).toEqual([
      { id: 's', status: 'finished', endReason: 'no_session_end' },
    ]);
    expect(t.rec.snapshots.map((s) => [s.kind, s.late])).toEqual([
      ['start', false],
      ['end', true],
    ]);
    expect(await readdir(join(t.home, 'spool', 'tmp'))).toEqual(['claude-code.Stop.freshtmp']);
    expect(t.store.getGaps(null)[0]?.reason).toMatch(/1 unfinished hook write was abandoned/);
    expect(t.store.retentionCutoffs).toEqual([t.clock.now - 30 * 24 * 60 * 60_000]);
    expect(t.store.analyzed.get('s')).toBe(-1);
  });
});

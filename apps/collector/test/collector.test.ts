import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stillwatchPaths } from '@stillwatch/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCollector, type CollectorHandle } from '../src/collector';
import { ensureDataDirs } from '../src/config';
import {
  acquirePidLock,
  CollectorRunningError,
  formatPidRecord,
  parseElapsed,
  parsePidRecord,
  readPidFile,
} from '../src/pidfile';
import { collectorStatus, startCollectorDetached, stopCollector } from '../src/process';

let root = '';
let swHome = '';
let userHome = '';
const handles: CollectorHandle[] = [];
const children: ChildProcess[] = [];
const savedHome = process.env.HOME;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sw-collector-'));
  swHome = join(root, 'sw');
  userHome = join(root, 'home');
  process.env.HOME = userHome;
});

afterEach(async () => {
  for (const h of handles.splice(0)) await h.stop();
  for (const c of children.splice(0)) c.kill('SIGKILL');
  process.env.HOME = savedHome;
  await rm(root, { recursive: true, force: true });
});

/** A long-running stand-in process; returns once it has started. */
async function sleeper(): Promise<ChildProcess & { pid: number }> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  children.push(child);
  await new Promise((r) => child.once('spawn', r));
  return child as ChildProcess & { pid: number };
}

function start(): Promise<CollectorHandle> {
  return runCollector({
    stillwatchHome: swHome,
    userHome,
    port: 0,
    webRoot: null,
    version: 'test',
  }).then((h) => {
    handles.push(h);
    return h;
  });
}

describe('pid records', () => {
  it('round-trips and rejects garbage', () => {
    const rec = { pid: 123, port: 7391, startedAt: 1_700_000_000_000 };
    expect(parsePidRecord(formatPidRecord(rec))).toEqual(rec);
    expect(parsePidRecord(formatPidRecord({ pid: 5, port: null, startedAt: null }))).toEqual({
      pid: 5,
      port: null,
      startedAt: null,
    });
    for (const bad of ['', 'abc', '0\n', '-1\n', '12 34\n']) expect(parsePidRecord(bad)).toBeNull();
    expect(parsePidRecord('9\n99999\n')?.port).toBeNull();
  });

  it('parses ps elapsed times', () => {
    expect(parseElapsed('   00:07\n')).toBe(7);
    expect(parseElapsed('01:02:03')).toBe(3723);
    expect(parseElapsed('2-00:00:01')).toBe(172_801);
    expect(parseElapsed('soon')).toBeNull();
  });
});

describe('pid lock', () => {
  const lockPath = () => join(root, 'collector.pid');

  it('refuses when a live collector holds it', async () => {
    const child = await sleeper();
    await writeFile(
      lockPath(),
      formatPidRecord({ pid: child.pid, port: 1234, startedAt: Date.now() }),
    );
    await expect(
      acquirePidLock(lockPath(), { pid: process.pid, port: null, startedAt: Date.now() }),
    ).rejects.toBeInstanceOf(CollectorRunningError);
  });

  it('replaces a lock whose process is gone', async () => {
    const child = await sleeper();
    const pid = child.pid;
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
    await writeFile(lockPath(), formatPidRecord({ pid, port: 1234, startedAt: Date.now() }));
    await acquirePidLock(lockPath(), { pid: process.pid, port: null, startedAt: 1 });
    expect((await readPidFile(lockPath()))?.pid).toBe(process.pid);
  });

  it('replaces a lock whose pid now belongs to a newer process', async () => {
    const child = await sleeper();
    // Recorded an hour before this process started: the pid was reused.
    await writeFile(
      lockPath(),
      formatPidRecord({ pid: child.pid, port: 1234, startedAt: Date.now() - 3_600_000 }),
    );
    await acquirePidLock(lockPath(), { pid: process.pid, port: null, startedAt: 2 });
    expect((await readPidFile(lockPath()))?.pid).toBe(process.pid);
  });

  it('replaces an unreadable lock', async () => {
    await writeFile(lockPath(), 'not a pid\n');
    await acquirePidLock(lockPath(), { pid: process.pid, port: null, startedAt: 3 });
    expect((await readPidFile(lockPath()))?.pid).toBe(process.pid);
  });
});

describe('runCollector', () => {
  it('listens on loopback, records its port, imports the spool, and cleans up on stop', async () => {
    const h = await start();
    const paths = stillwatchPaths(swHome);
    expect(h.port).toBeGreaterThan(0);
    expect(await readPidFile(paths.pidFile)).toMatchObject({ pid: process.pid, port: h.port });
    expect(await collectorStatus(swHome)).toEqual({
      running: true,
      pid: process.pid,
      port: h.port,
    });

    const res = await fetch(`http://127.0.0.1:${h.port}/api/sessions`);
    expect(res.status).toBe(401);

    const payload = {
      session_id: 'sess-1',
      hook_event_name: 'Notification',
      cwd: root,
      message: 'hello',
      transcript_path: null,
    };
    await writeFile(
      join(paths.spoolNew, 'claude-code.Notification.abcd1234'),
      JSON.stringify(payload),
    );
    await vi.waitFor(() => {
      expect(h.pipeline.store.getSession('sess-1')).not.toBeNull();
    });

    await h.stop();
    await h.stop();
    expect(await readPidFile(paths.pidFile)).toBeNull();
    expect(await collectorStatus(swHome)).toEqual({ running: false, pid: null, port: null });
  });

  it('refuses to start a second collector on the same data directory', async () => {
    await start();
    await expect(start()).rejects.toBeInstanceOf(CollectorRunningError);
  });

  it('releases the lock when startup fails', async () => {
    const first = await start();
    const other = join(root, 'sw2');
    // The port is taken, so the second collector fails after taking its own lock.
    await expect(
      runCollector({
        stillwatchHome: other,
        userHome,
        port: first.port,
        webRoot: null,
        version: 't',
      }),
    ).rejects.toThrow();
    expect(await readPidFile(stillwatchPaths(other).pidFile)).toBeNull();
    expect((await readPidFile(stillwatchPaths(swHome).pidFile))?.port).toBe(first.port);
  });
});

describe('process control', () => {
  it('reports nothing running without a pid file, and stop returns false', async () => {
    expect(await collectorStatus(swHome)).toEqual({ running: false, pid: null, port: null });
    expect(await stopCollector(swHome)).toBe(false);
  });

  it('treats a starting collector (no port yet) as not running', async () => {
    const child = await sleeper();
    const paths = stillwatchPaths(swHome);
    await ensureDataDirs(swHome);
    await writeFile(
      paths.pidFile,
      formatPidRecord({ pid: child.pid, port: null, startedAt: Date.now() }),
    );
    expect(await collectorStatus(swHome)).toEqual({ running: false, pid: child.pid, port: null });
  });

  it('stops a running collector with SIGTERM and removes its lock', async () => {
    const child = await sleeper();
    const exited = new Promise((r) => child.once('exit', (_code, signal) => r(signal)));
    const paths = stillwatchPaths(swHome);
    await ensureDataDirs(swHome);
    await writeFile(
      paths.pidFile,
      formatPidRecord({ pid: child.pid, port: 4321, startedAt: Date.now() }),
    );
    expect(await stopCollector(swHome, { timeoutMs: 2_000 })).toBe(true);
    expect(await exited).toBe('SIGTERM');
    expect(await readPidFile(paths.pidFile)).toBeNull();
  });

  it('removes a stale pid file and reports nothing stopped', async () => {
    const paths = stillwatchPaths(swHome);
    await ensureDataDirs(swHome);
    await writeFile(paths.pidFile, formatPidRecord({ pid: 999_999, port: 1, startedAt: 1 }));
    expect(await stopCollector(swHome)).toBe(false);
    expect(await readPidFile(paths.pidFile)).toBeNull();
  });

  it('starts the CLI detached with the data directory and logs its output', async () => {
    const script = join(root, 'fake-cli.mjs');
    const out = join(root, 'argv.json');
    await writeFile(
      script,
      `import { writeFileSync } from 'node:fs';\n` +
        `writeFileSync(${JSON.stringify(out)}, JSON.stringify({ argv: process.argv.slice(2), home: process.env.STILLWATCH_HOME }));\n` +
        `console.log('fake collector says hi');\n`,
    );
    const { pid } = await startCollectorDetached({
      stillwatchHome: swHome,
      nodePath: process.execPath,
      cliPath: script,
    });
    expect(pid).toBeGreaterThan(0);
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(out, 'utf8'))).toEqual({
        argv: ['collector', 'run'],
        home: swHome,
      });
    });
    await vi.waitFor(async () => {
      expect(await readFile(stillwatchPaths(swHome).logFile, 'utf8')).toContain(
        'fake collector says hi',
      );
    });
  });

  it('rejects when the node binary cannot be started', async () => {
    await expect(
      startCollectorDetached({
        stillwatchHome: swHome,
        nodePath: join(root, 'no-such-node'),
        cliPath: 'x',
      }),
    ).rejects.toThrow();
  });
});

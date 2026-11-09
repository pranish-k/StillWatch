import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureDataDirs,
  loadOrCreateConfig,
  readConfig,
  resolveStillwatchHome,
  saveConfig,
} from '../src/config';

describe('config', () => {
  let home: string;

  beforeEach(async () => {
    home = join(await mkdtemp(join(tmpdir(), 'sw-config-')), 'home');
  });

  afterEach(async () => {
    await rm(join(home, '..'), { recursive: true, force: true });
  });

  it('resolves the home from the environment or the user home', () => {
    expect(resolveStillwatchHome({ STILLWATCH_HOME: '/tmp/x/../y' })).toBe('/tmp/y');
    expect(resolveStillwatchHome({ STILLWATCH_HOME: '' })).toBe(join(homedir(), '.stillwatch'));
    expect(resolveStillwatchHome({})).toBe(join(homedir(), '.stillwatch'));
  });

  it('creates data directories with mode 0700 and tightens loose ones', async () => {
    await mkdir(join(home, 'logs'), { recursive: true });
    await chmod(join(home, 'logs'), 0o755);
    await chmod(home, 0o755);
    await ensureDataDirs(home);
    for (const dir of ['', 'spool', 'spool/tmp', 'spool/new', 'bin', 'backups', 'run', 'logs']) {
      expect((await stat(join(home, dir))).mode & 0o777).toBe(0o700);
    }
    await ensureDataDirs(home);
  });

  it('creates, reads, and saves config with mode 0600', async () => {
    expect(await readConfig(home)).toBeNull();
    const created = await loadOrCreateConfig(home, 1234);
    expect(created).toMatchObject({ v: 1, port: 7391, retentionDays: 30, createdAt: 1234 });
    expect((await stat(join(home, 'config.json'))).mode & 0o777).toBe(0o600);
    expect(await loadOrCreateConfig(home)).toEqual(created);
    const next = { ...created, port: 8000, retentionDays: 7 };
    await saveConfig(home, next);
    expect(await readConfig(home)).toEqual(next);
    expect((await stat(join(home, 'config.json'))).mode & 0o777).toBe(0o600);
  });

  it('repairs invalid fields and keeps valid ones', async () => {
    const created = await loadOrCreateConfig(home, 1);
    await writeFile(
      join(home, 'config.json'),
      JSON.stringify({ ...created, port: 'x', retentionDays: -3, authSecret: 'short' }),
    );
    const repaired = await loadOrCreateConfig(home);
    expect(repaired.port).toBe(7391);
    expect(repaired.retentionDays).toBe(30);
    expect(repaired.authSecret).not.toBe('short');
    expect(repaired.fingerprintKey).toBe(created.fingerprintKey);
    expect(await readConfig(home)).toEqual(repaired);
  });

  it('throws on a corrupt file and never overwrites it', async () => {
    await mkdir(home, { recursive: true });
    await writeFile(join(home, 'config.json'), '{not json');
    await expect(readConfig(home)).rejects.toThrow(/not valid JSON/);
    await expect(loadOrCreateConfig(home)).rejects.toThrow(/not valid JSON/);
    expect(await readFile(join(home, 'config.json'), 'utf8')).toBe('{not json');
  });

  it('creates one config under concurrent first use', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => loadOrCreateConfig(home)));
    for (const r of results) expect(r.authSecret).toBe(results[0]?.authSecret);
  });
});

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DB_SCHEMA_VERSION, installSqliteWarningFilter, openStore } from '../src/index';
import { loadSqlite } from '../src/sqlite';
import { MIGRATIONS } from '../src/migrations';
import { ev, item, openTemp, tempDir } from './helpers';

function rawDb(path: string) {
  const { DatabaseSync } = loadSqlite();
  return new DatabaseSync(path);
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

describe('openStore', () => {
  it('creates the schema with the required pragmas', () => {
    const store = openTemp();
    const db = rawDb(store.path);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: DB_SCHEMA_VERSION });
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA auto_vacuum').get()).toEqual({ auto_vacuum: 2 });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'agents',
        'artifacts',
        'domains',
        'events',
        'file_changes',
        'findings',
        'gaps',
        'links',
        'meta',
        'projects',
        'sessions',
        'snapshots',
      ]),
    );
    db.close();
    expect(MIGRATIONS[MIGRATIONS.length - 1]?.version).toBe(DB_SCHEMA_VERSION);
  });

  it('reopens an existing database without re-running migrations and keeps data', () => {
    const path = join(tempDir(), 'db.sqlite');
    const first = openStore({ path });
    first.insertEvents([
      item(ev('session.start', { source: 'startup', model: null, sessionTitle: null })),
    ]);
    first.close();
    const second = openStore({ path });
    expect(second.counts().events).toBe(1);
    second.close();
  });

  it('creates the database and its WAL files with mode 0600', () => {
    const dir = tempDir();
    const path = join(dir, 'db.sqlite');
    const store = openStore({ path });
    store.insertEvents([
      item(ev('session.start', { source: null, model: null, sessionTitle: null })),
    ]);
    expect(mode(path)).toBe(0o600);
    for (const suffix of ['-wal', '-shm']) {
      expect(existsSync(path + suffix)).toBe(true);
      expect(mode(path + suffix)).toBe(0o600);
    }
    store.close();
  });

  it('refuses a database newer than this code', () => {
    const path = join(tempDir(), 'db.sqlite');
    openStore({ path }).close();
    const db = rawDb(path);
    db.exec(`PRAGMA user_version = ${String(DB_SCHEMA_VERSION + 1)}`);
    db.close();
    expect(() => openStore({ path })).toThrow(/newer than this Stillwatch supports/);
    expect(() => openStore({ path, readonly: true })).toThrow(/newer/);
  });

  it('opens read-only without migrating and rejects writes', () => {
    const path = join(tempDir(), 'db.sqlite');
    const writer = openStore({ path });
    writer.insertEvents([
      item(ev('session.start', { source: null, model: null, sessionTitle: null })),
    ]);
    writer.close();
    const reader = openStore({ path, readonly: true });
    expect(reader.counts().sessions).toBe(1);
    expect(() =>
      reader.insertEvents([
        item(ev('session.start', { source: null, model: null, sessionTitle: null })),
      ]),
    ).toThrow();
    reader.close();
  });

  it('errors clearly when a read-only open finds an unmigrated database', () => {
    const path = join(tempDir(), 'empty.sqlite');
    rawDb(path).close();
    expect(() => openStore({ path, readonly: true })).toThrow(/older than/);
  });

  it('lets two connections share the database in WAL mode', () => {
    const path = join(tempDir(), 'db.sqlite');
    const a = openStore({ path });
    const b = openStore({ path });
    const reader = openStore({ path, readonly: true });
    a.insertEvents([
      item(
        ev('session.start', { source: null, model: null, sessionTitle: null }, { sessionId: 'a' }),
      ),
    ]);
    b.insertEvents([
      item(
        ev('session.start', { source: null, model: null, sessionTitle: null }, { sessionId: 'b' }),
      ),
    ]);
    expect(a.counts().sessions).toBe(2);
    expect(reader.getSession('b')?.id).toBe('b');
    reader.close();
    a.close();
    b.close();
  });

  it('is safe to close twice', () => {
    const store = openTemp();
    store.close();
    expect(() => {
      store.close();
    }).not.toThrow();
  });
});

describe('installSqliteWarningFilter', () => {
  it('drops only the SQLite ExperimentalWarning and is idempotent', () => {
    const emitWarning = (): unknown => Reflect.get(process, 'emitWarning');
    const original = emitWarning();
    const spy = vi.fn();
    Reflect.set(process, 'emitWarning', spy);
    try {
      installSqliteWarningFilter();
      const once = emitWarning();
      installSqliteWarningFilter();
      expect(emitWarning()).toBe(once);
      process.emitWarning(
        'SQLite is an experimental feature and might change at any time',
        'ExperimentalWarning',
      );
      process.emitWarning('SQLite is an experimental feature', { type: 'ExperimentalWarning' });
      expect(spy).not.toHaveBeenCalled();
      process.emitWarning('Something else is experimental', 'ExperimentalWarning');
      process.emitWarning('SQLite thing', 'DeprecationWarning');
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.set(process, 'emitWarning', original);
    }
  });
});

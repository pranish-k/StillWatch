/**
 * One SQLite connection: opening with the required pragmas and file modes,
 * migrations, a prepared statement cache, and transactions.
 */
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';
import { num, type Row } from './rows';
import { loadSqlite } from './sqlite';

const FILE_MODE = 0o600;

/** Options for opening a connection. */
export type ConnectionOptions = {
  path: string;
  readonly: boolean;
  /** Schema version this code understands. */
  schemaVersion: number;
  now: () => number;
};

/** A database connection with cached statements and transaction support. */
export class Connection {
  readonly path: string;
  readonly readonly: boolean;
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private txDepth = 0;
  private closed = false;

  private constructor(db: DatabaseSync, path: string, readonly: boolean) {
    this.db = db;
    this.path = path;
    this.readonly = readonly;
  }

  /** Opens (and for read-write connections, creates and migrates) the database. */
  static open(options: ConnectionOptions): Connection {
    const { DatabaseSync } = loadSqlite();
    if (!options.readonly) ensurePrivateFile(options.path);
    const db = new DatabaseSync(options.path, { readOnly: options.readonly });
    const conn = new Connection(db, options.path, options.readonly);
    try {
      if (options.readonly) {
        conn.exec('PRAGMA busy_timeout = 5000');
        conn.exec('PRAGMA foreign_keys = ON');
        conn.exec('PRAGMA query_only = ON');
        checkReadonlyVersion(conn, options.schemaVersion);
      } else {
        // auto_vacuum only takes effect before the first table is created.
        conn.exec('PRAGMA busy_timeout = 5000');
        conn.exec('PRAGMA auto_vacuum = INCREMENTAL');
        conn.exec('PRAGMA journal_mode = WAL');
        conn.exec('PRAGMA synchronous = NORMAL');
        conn.exec('PRAGMA foreign_keys = ON');
        migrate(conn, options.schemaVersion, options.now);
        restrictSidecarFiles(options.path);
      }
    } catch (error) {
      db.close();
      throw error;
    }
    return conn;
  }

  /** Runs SQL without parameters (pragmas, schema, transaction control). */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** Returns the cached prepared statement for `sql`. */
  stmt(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (statement === undefined) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  /** Runs a cached statement with positional parameters. */
  run(sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number } {
    const result = this.stmt(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  /** First row of a cached statement, or `null`. */
  get(sql: string, ...params: SQLInputValue[]): Row | null {
    return this.stmt(sql).get(...params) ?? null;
  }

  /** All rows of a cached statement. */
  all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.stmt(sql).all(...params);
  }

  /** Iterates the rows of a cached statement without loading them all. */
  iterate(sql: string, ...params: SQLInputValue[]): Iterable<Row> {
    const iterator = this.stmt(sql).iterate(...params);
    return { [Symbol.iterator]: () => iterator };
  }

  /**
   * Runs `fn` in a `BEGIN IMMEDIATE` transaction, committing on success and
   * rolling back on any error. Nested calls join the outer transaction.
   */
  tx<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      this.txDepth++;
      try {
        return fn();
      } finally {
        this.txDepth--;
      }
    }
    this.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const result = fn();
      this.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.exec('ROLLBACK');
      } catch {
        // The transaction may already be gone (for example after SQLITE_FULL).
      }
      throw error;
    } finally {
      this.txDepth = 0;
    }
  }

  /** Re-applies file mode 0600 to the -wal and -shm files, which SQLite may create later. */
  restrictFiles(): void {
    if (!this.readonly) restrictSidecarFiles(this.path);
  }

  /** Closes the connection. Safe to call more than once. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.readonly) {
      try {
        this.exec('PRAGMA optimize');
      } catch {
        // Best effort only.
      }
    }
    this.statements.clear();
    this.db.close();
  }
}

function ensurePrivateFile(path: string): void {
  try {
    writeFileSync(path, '', { mode: FILE_MODE, flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  chmodSync(path, FILE_MODE);
}

function restrictSidecarFiles(path: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const file = path + suffix;
    try {
      if (existsSync(file)) chmodSync(file, FILE_MODE);
    } catch (error) {
      // The file can disappear between the check and the chmod when another connection checkpoints.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function userVersion(conn: Connection): number {
  const row = conn.get('PRAGMA user_version');
  return row === null ? 0 : num(row, 'user_version');
}

function newerError(path: string, found: number, supported: number): Error {
  return new Error(
    `storage: database ${path} has schema version ${found}, newer than this Stillwatch supports (${supported}); upgrade Stillwatch`,
  );
}

function checkReadonlyVersion(conn: Connection, supported: number): void {
  const found = userVersion(conn);
  if (found > supported) throw newerError(conn.path, found, supported);
  if (found < supported) {
    throw new Error(
      `storage: database ${conn.path} has schema version ${found}, older than ${supported}; open it read-write once to migrate`,
    );
  }
}

function migrate(conn: Connection, supported: number, now: () => number): void {
  const before = userVersion(conn);
  if (before > supported) throw newerError(conn.path, before, supported);
  if (before === supported) return;
  conn.tx(() => {
    // Re-read inside the write lock: another process may have migrated meanwhile.
    const current = userVersion(conn);
    if (current > supported) throw newerError(conn.path, current, supported);
    for (const migration of MIGRATIONS) {
      if (migration.version <= current || migration.version > supported) continue;
      conn.exec(migration.sql);
      conn.exec(`PRAGMA user_version = ${String(migration.version)}`);
    }
    if (current === 0) {
      conn.run(
        'INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)',
        'created_at',
        String(now()),
      );
    }
  });
}

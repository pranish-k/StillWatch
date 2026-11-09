/**
 * Lazy access to `node:sqlite` and the filter for its ExperimentalWarning.
 *
 * The module is loaded with `process.getBuiltinModule` on first use, so that
 * importing `@stillwatch/storage` never triggers the warning by itself and the
 * filter is always in place before the module loads.
 */
import type * as Sqlite from 'node:sqlite';

/** The `node:sqlite` module namespace. */
export type SqliteModule = typeof Sqlite;

const FILTER_MARK = Symbol.for('stillwatch.storage.sqliteWarningFilter');

type MarkedFunction = { [FILTER_MARK]?: true };

let loaded: SqliteModule | null = null;

/** Returns `node:sqlite`, loading it on first use after installing the warning filter. */
export function loadSqlite(): SqliteModule {
  if (loaded !== null) return loaded;
  installSqliteWarningFilter();
  const mod = process.getBuiltinModule('node:sqlite') as SqliteModule | undefined;
  if (mod === undefined) {
    throw new Error('node:sqlite is not available; Stillwatch needs Node.js 22.13 or newer');
  }
  loaded = mod;
  return mod;
}

/**
 * Filters Node's ExperimentalWarning for node:sqlite (and only that warning).
 * Idempotent, also across several copies of this module.
 */
export function installSqliteWarningFilter(): void {
  const current: unknown = Reflect.get(process, 'emitWarning');
  if (typeof current !== 'function') return;
  if ((current as MarkedFunction)[FILTER_MARK] === true) return;
  const filtered = function emitWarning(warning: string | Error, ...rest: unknown[]): void {
    if (isSqliteExperimentalWarning(warning, rest[0])) return;
    Reflect.apply(current, process, [warning, ...rest]);
  };
  Object.defineProperty(filtered, FILTER_MARK, { value: true });
  process.emitWarning = filtered;
}

/** True for the ExperimentalWarning Node emits when `node:sqlite` loads. */
export function isSqliteExperimentalWarning(warning: unknown, typeOrOptions: unknown): boolean {
  let type: string | null = null;
  if (typeof typeOrOptions === 'string') {
    type = typeOrOptions;
  } else if (typeof typeOrOptions === 'object' && typeOrOptions !== null) {
    const value = (typeOrOptions as { type?: unknown }).type;
    if (typeof value === 'string') type = value;
  }
  let message: string;
  if (typeof warning === 'string') {
    message = warning;
  } else if (warning instanceof Error) {
    message = warning.message;
    type ??= warning.name;
  } else {
    return false;
  }
  return type === 'ExperimentalWarning' && /\bSQLite\b/i.test(message);
}

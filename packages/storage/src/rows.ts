/**
 * Typed accessors for rows returned by `node:sqlite`.
 *
 * Rows are `Record<string, SQLOutputValue>`. These helpers read one column
 * with the type the schema guarantees and throw on anything else, so a
 * corrupted or hand-edited database fails loudly instead of leaking wrong
 * types into the rest of Stillwatch.
 */
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';

/** One result row. */
export type Row = Record<string, SQLOutputValue>;

function columnError(column: string, expected: string, value: SQLOutputValue | undefined): Error {
  const actual = value === null ? 'null' : typeof value;
  return new TypeError(`storage: column "${column}" should be ${expected}, got ${actual}`);
}

/** A non-null TEXT column. */
export function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw columnError(column, 'text', value);
  return value;
}

/** A nullable TEXT column. */
export function textOrNull(row: Row, column: string): string | null {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== 'string') throw columnError(column, 'text or null', value);
  return value;
}

/** A non-null INTEGER or REAL column. */
export function num(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw columnError(column, 'a number', value);
}

/** A nullable INTEGER or REAL column. */
export function numOrNull(row: Row, column: string): number | null {
  const value = row[column];
  if (value === null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw columnError(column, 'a number or null', value);
}

/** An INTEGER 0/1 column as a boolean. */
export function bool(row: Row, column: string): boolean {
  return num(row, column) !== 0;
}

/**
 * Parses a JSON column that Stillwatch wrote itself. The shape is trusted
 * because only this package writes these columns.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed parse of a trusted column
export function json<T>(row: Row, column: string): T {
  return JSON.parse(text(row, column)) as T;
}

/** A nullable JSON column. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed parse of a trusted column
export function jsonOrNull<T>(row: Row, column: string): T | null {
  const value = textOrNull(row, column);
  return value === null ? null : (JSON.parse(value) as T);
}

/** Converts a boolean to the 0/1 integer SQLite stores. */
export function flag(value: boolean): SQLInputValue {
  return value ? 1 : 0;
}

/** Number of changed rows from a statement result. */
export function changes(result: { changes: number | bigint }): number {
  return Number(result.changes);
}

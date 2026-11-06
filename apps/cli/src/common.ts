import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CREATED_HOOKS_OBJECT } from '@stillwatch/installer';
import {
  isRecord,
  stillwatchPaths,
  type InstallRecord,
  type SessionListQuery,
  type StillwatchConfig,
} from '@stillwatch/schema';
import type { Store } from '@stillwatch/storage';
import { CliError } from './args';
import { exists, findExecutable } from './fsutil';
import type { Ctx } from './output';

export function stillwatchHome(ctx: Ctx): string {
  return resolve(ctx.deps.cwd, ctx.deps.collector.resolveStillwatchHome(ctx.deps.env));
}

/** Reads config.json; a corrupt file becomes a CliError. */
export async function readConfigOrFail(ctx: Ctx, home: string): Promise<StillwatchConfig | null> {
  try {
    return await ctx.deps.collector.readConfig(home);
  } catch (error) {
    throw new CliError(
      `Cannot read ${ctx.path(stillwatchPaths(home).config)}: ${errorMessage(error)}`,
    );
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `claude --version` from the `claude` found on the injected PATH. */
export async function detectClaude(ctx: Ctx): Promise<string | null> {
  const binary = await findExecutable('claude', ctx.deps.env.PATH);
  if (binary === null) return null;
  return ctx.deps.installer.detectClaudeVersion({ claudeBinary: binary, timeoutMs: 3000 });
}

/**
 * The install record as stored. `createdEventKeys` is not part of the
 * `InstallRecord` schema yet; the CLI stores it alongside so uninstall can
 * remove exactly the event keys install created.
 */
export type StoredInstallRecord = InstallRecord & { createdEventKeys?: string[] };

/** Event keys (and the hooks object marker) that Stillwatch's install created. */
export async function createdKeysOf(record: InstallRecord): Promise<string[]> {
  const stored: unknown = (record as StoredInstallRecord).createdEventKeys;
  if (Array.isArray(stored) && stored.every((k) => typeof k === 'string')) return stored;
  // Older records: derive from what existed before install.
  if (!record.settingsExisted) return [...record.events, CREATED_HOOKS_OBJECT];
  if (record.backupPath === null) return [];
  try {
    const before: unknown = JSON.parse(await readFile(record.backupPath, 'utf8'));
    if (!isRecord(before)) return [];
    if (!isRecord(before.hooks)) return [...record.events, CREATED_HOOKS_OBJECT];
    const hooks = before.hooks;
    return record.events.filter((event) => !Object.hasOwn(hooks, event));
  } catch {
    return [];
  }
}

export function isNpxCache(path: string): boolean {
  return path.includes('/_npx/');
}

/** Opens the store, or returns null when the database does not exist yet. */
export async function openStoreIfExists(
  ctx: Ctx,
  home: string,
  readonly: boolean,
): Promise<Store | null> {
  const path = stillwatchPaths(home).db;
  if (!(await exists(path))) return null;
  ctx.deps.storage.installSqliteWarningFilter();
  return ctx.deps.storage.openStore({ path, readonly, now: ctx.deps.now });
}

function listQuery(sort: SessionListQuery['sort'], limit: number, cursor: string | null) {
  return { risk: null, status: null, q: null, projectId: null, sort, limit, cursor };
}

export function sessionQuery(limit: number): SessionListQuery {
  return listQuery('review', limit, null);
}

/** Resolves "latest", an exact session id, or a unique id prefix. */
export function resolveSessionId(store: Store, ref: string): string {
  if (ref === 'latest') {
    const latest = store.listSessions(listQuery('recent', 1, null)).sessions[0];
    if (!latest) throw new CliError('No sessions recorded yet.');
    return latest.id;
  }
  if (store.getSession(ref) !== null) return ref;
  const matches: string[] = [];
  let cursor: string | null = null;
  do {
    const page = store.listSessions(listQuery('recent', 200, cursor));
    for (const session of page.sessions) {
      if (session.id.startsWith(ref)) matches.push(session.id);
    }
    cursor = page.nextCursor;
  } while (cursor !== null && matches.length < 2);
  if (matches.length === 1 && matches[0] !== undefined) return matches[0];
  if (matches.length === 0) {
    throw new CliError(`No session matches '${ref}'. Run 'stillwatch sessions' to list them.`);
  }
  throw new CliError(`'${ref}' matches several sessions. Use more of the id.`);
}

/** Asks a yes/no question. Without a terminal, refuses unless `yes`. */
export async function confirm(
  ctx: Ctx,
  question: string,
  yes: boolean,
  command: string,
): Promise<boolean> {
  if (yes) return true;
  if (!ctx.deps.stdinIsTTY) {
    throw new CliError(`Refusing to ${command} without confirmation. Rerun with --yes.`);
  }
  const answer = await ctx.deps.prompt(`${question} [y/N] `);
  return /^y(es)?$/i.test(answer.trim());
}

import { chmod, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { stillwatchPaths, type RiskLevel, type SessionListResponse } from '@stillwatch/schema';
import type { Store } from '@stillwatch/storage';
import { CliError, UsageError, parse, positiveInt } from '../args';
import {
  confirm,
  openStoreIfExists,
  resolveSessionId,
  sessionQuery,
  stillwatchHome,
} from '../common';
import { writeFileAtomic } from '../fsutil';
import {
  clean,
  cleanDocument,
  formatDateTime,
  plural,
  table,
  truncate,
  type Ctx,
  type Style,
} from '../output';

async function withStore<T>(
  ctx: Ctx,
  readonly: boolean,
  onMissing: () => T,
  fn: (store: Store) => T | Promise<T>,
): Promise<T> {
  const store = await openStoreIfExists(ctx, stillwatchHome(ctx), readonly);
  if (store === null) return onMissing();
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

function paintRisk(s: Style, risk: string, padded: string): string {
  const level = risk as RiskLevel;
  switch (level) {
    case 'high':
      return s.red(padded);
    case 'medium':
      return s.yellow(padded);
    case 'unknown':
      return s.dim(padded);
    case 'low':
      return padded;
  }
}

export async function sessionsCommand(ctx: Ctx, args: string[]): Promise<number> {
  const { values } = parse('sessions', args, {
    json: { type: 'boolean' },
    limit: { type: 'string' },
  });
  const limit =
    values.limit === undefined ? 20 : positiveInt('sessions', 'limit', values.limit, 200);
  const empty: SessionListResponse = { sessions: [], nextCursor: null, total: 0 };
  const list = await withStore(
    ctx,
    true,
    () => empty,
    (store) => store.listSessions(sessionQuery(limit)),
  );
  if (values.json === true) {
    ctx.out(JSON.stringify(list, null, 2));
    return 0;
  }
  if (list.sessions.length === 0) {
    ctx.out('No sessions recorded yet. Start a Claude Code session after `stillwatch install`.');
    return 0;
  }
  const rows = list.sessions.map((session) => [
    session.risk,
    session.status,
    formatDateTime(session.startedAt),
    truncate(clean(session.projectName ?? '-'), 24),
    String(session.eventCount),
    String(session.findingCount),
    session.id.slice(0, 8),
    truncate(clean(session.title ?? '(untitled)'), 60),
  ]);
  ctx.out(
    table(
      ['RISK', 'STATUS', 'STARTED', 'PROJECT', 'EVENTS', 'FINDINGS', 'ID', 'TITLE'],
      rows,
      (column, value, padded) => (column === 0 ? paintRisk(ctx.s, value, padded) : padded),
    ),
  );
  if (list.total > list.sessions.length) {
    ctx.out(ctx.s.dim(`Showing ${list.sessions.length} of ${list.total}. Use --limit for more.`));
  }
  ctx.out(ctx.s.dim("Run 'stillwatch report <id>' for details."));
  return 0;
}

export async function reportCommand(ctx: Ctx, args: string[]): Promise<number> {
  const { values, positionals } = parse('report', args, { out: { type: 'string' } }, true);
  if (positionals.length !== 1 || positionals[0] === undefined) {
    throw new UsageError('give one session id, or "latest"', 'report');
  }
  const ref = positionals[0];
  const { deps } = ctx;
  const markdown = await withStore(
    ctx,
    true,
    () => {
      throw new CliError('No sessions recorded yet.');
    },
    (store) => {
      const id = resolveSessionId(store, ref);
      const detail = store.getSessionDetail(id);
      if (detail === null) throw new CliError(`Session ${clean(id)} was not found.`);
      const report = deps.reports.buildSessionReport(detail, { now: deps.now(), home: deps.home });
      return deps.reports.renderMarkdownReport(report);
    },
  );
  if (values.out !== undefined) {
    const path = resolve(deps.cwd, values.out);
    await writeFileAtomic(path, markdown, 0o600);
    await chmod(path, 0o600);
    ctx.out(`Wrote the report to ${ctx.path(path)}.`);
    return 0;
  }
  deps.stdout.write(deps.stdout.isTTY ? cleanDocument(markdown) : markdown);
  if (!markdown.endsWith('\n')) deps.stdout.write('\n');
  return 0;
}

export async function deleteDataCommand(ctx: Ctx, args: string[]): Promise<number> {
  const { values } = parse('delete-data', args, {
    session: { type: 'string' },
    'older-than': { type: 'string' },
    all: { type: 'boolean' },
    yes: { type: 'boolean' },
  });
  const selected = [
    values.session !== undefined,
    values['older-than'] !== undefined,
    values.all === true,
  ];
  if (selected.filter(Boolean).length !== 1) {
    throw new UsageError('choose exactly one of --session, --older-than, or --all', 'delete-data');
  }
  const days =
    values['older-than'] !== undefined
      ? positiveInt('delete-data', 'older-than', values['older-than'], 36_500)
      : null;
  const yes = values.yes === true;
  const home = stillwatchHome(ctx);
  const { deps } = ctx;

  return withStore(
    ctx,
    false,
    () => {
      ctx.out('No data recorded yet; nothing to delete.');
      return 0;
    },
    async (store) => {
      if (values.session !== undefined) {
        const id = resolveSessionId(store, values.session);
        const session = store.getSession(id);
        const sessionTitle = session?.title ?? null;
        const title = sessionTitle !== null ? ` (${truncate(clean(sessionTitle), 60)})` : '';
        if (!(await confirm(ctx, `Delete session ${clean(id)}${title}?`, yes, 'delete data'))) {
          ctx.out('Cancelled.');
          return 1;
        }
        store.deleteSession(id);
        ctx.out(`Deleted session ${clean(id)}.`);
        return 0;
      }
      if (days !== null) {
        const question = `Delete every session with no activity in the last ${plural(days, 'day')}?`;
        if (!(await confirm(ctx, question, yes, 'delete data'))) {
          ctx.out('Cancelled.');
          return 1;
        }
        const count = store.deleteSessionsBefore(deps.now() - days * 86_400_000);
        ctx.out(`Deleted ${plural(count, 'session')}.`);
        return 0;
      }
      const { sessions } = store.counts();
      const question = `Delete all ${plural(sessions, 'recorded session')} and pending spool records?`;
      if (!(await confirm(ctx, question, yes, 'delete data'))) {
        ctx.out('Cancelled.');
        return 1;
      }
      store.deleteAll();
      const spooled = await clearSpool(home);
      ctx.out(
        `Deleted ${plural(sessions, 'session')}${spooled > 0 ? ` and ${plural(spooled, 'spool record')}` : ''}.`,
      );
      return 0;
    },
  );
}

async function clearSpool(home: string): Promise<number> {
  const paths = stillwatchPaths(home);
  let count = 0;
  for (const dir of [paths.spoolNew, paths.spoolTmp]) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      await rm(join(dir, name), { force: true, recursive: true });
      count++;
    }
  }
  return count;
}

export async function verifyCommand(ctx: Ctx, args: string[]): Promise<number> {
  const { values } = parse('verify', args, { session: { type: 'string' } });
  const { s } = ctx;
  return withStore(
    ctx,
    true,
    () => {
      ctx.out('No data recorded yet; nothing to verify.');
      return 0;
    },
    (store) => {
      const id = values.session !== undefined ? resolveSessionId(store, values.session) : undefined;
      const results = store.verifyChain(id);
      const broken = results.filter((r) => !r.ok);
      const events = results.reduce((sum, r) => sum + r.events, 0);
      for (const r of broken) {
        ctx.out(
          `${s.red('BROKEN')} ${clean(r.sessionId)}: ${r.firstBadSeq !== null ? `first bad event #${r.firstBadSeq}` : 'chain mismatch'}${r.reason !== null ? ` (${clean(r.reason)})` : ''}`,
        );
      }
      const scope = `${plural(results.length, 'session')}, ${plural(events, 'event')}`;
      if (broken.length > 0) {
        ctx.out(
          `${s.red(`${broken.length} of ${results.length} chains are broken`)} (${scope}). Events were changed or removed outside Stillwatch.`,
        );
        return 1;
      }
      ctx.out(`${s.green('ok')} Verified ${scope}: every hash chain is intact.`);
      return 0;
    },
  );
}

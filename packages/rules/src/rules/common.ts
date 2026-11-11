/** Helpers shared by rule families. */
import {
  displayPath,
  type PathClass,
  type RuleId,
  type Severity,
  type SignalKind,
  type StoredEvent,
} from '@stillwatch/schema';
import type { PathChange, RuleContext, SignalRecord } from '../context';
import type { FindingDraft } from '../findings';
import { writtenContent } from '../text';

/** A path as the report shows it: relative to the project, or with `~`. */
export function show(ctx: RuleContext, path: string): string {
  return displayPath(path, ctx.input.session.projectRoot, ctx.input.home);
}

/** Path changes that carry a class. */
export function changesWith(ctx: RuleContext, cls: PathClass): PathChange[] {
  return ctx.pathChanges.filter((c) => c.classes.includes(cls));
}

/** "added", "changed", or "deleted", for titles and reasons. */
export function verb(change: PathChange): 'added' | 'changed' | 'deleted' {
  const s = change.surface?.change;
  const d = change.diff?.change;
  if (s === 'created' || d === 'added') return 'added';
  if (s === 'deleted' || d === 'deleted') return 'deleted';
  if (s === undefined && d === undefined) {
    const last = change.writes[change.writes.length - 1];
    if (last?.access.op === 'delete') return 'deleted';
  }
  return 'changed';
}

/** New content written by tool calls to a changed path, or null when unknown. */
export function contentOf(change: PathChange): string | null {
  const parts: string[] = [];
  for (const w of change.writes) {
    const tool = w.event.tool;
    if (w.access.via !== 'tool' || tool === null) continue;
    const content = writtenContent(tool);
    if (content !== null) parts.push(content);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

/** Shell commands behind a path change, for content checks when no tool wrote the text. */
export function commandTextOf(change: PathChange): string | null {
  const parts: string[] = [];
  for (const w of change.writes) {
    const command = w.event.tool?.input.command;
    if (w.access.via !== 'tool' && typeof command === 'string') parts.push(command);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * git subcommands that bring other commits into the working tree. Checkout,
 * switch, reset, and stash are left out on purpose: they can surface a file the
 * agent planted some other way, and must not lower its finding.
 */
const GIT_HISTORY = new Set(['pull', 'merge', 'rebase', 'am', 'cherry-pick']);

/** True for a git command that brings other commits into the working tree (pull, merge, rebase). */
export function isGitHistoryCommand(program: string, args: readonly string[]): boolean {
  if (program !== 'git') return false;
  const sub = args.find((a) => !a.startsWith('-'));
  return sub !== undefined && GIT_HISTORY.has(sub);
}

/**
 * True when the only thing explaining a change is a git command that brought
 * in existing commits, so the content came from repository history rather
 * than from something the agent wrote.
 */
function fromGitHistory(ctx: RuleContext, change: PathChange): boolean {
  if (
    change.writes.length > 0 ||
    change.attribution !== 'shell' ||
    change.attributionEventIds.length === 0 ||
    change.diff?.committed !== true
  )
    return false;
  return change.attributionEventIds.every((id) => {
    const event = ctx.events.find((e) => e.id === id);
    return event?.facts.commands.some((c) => isGitHistoryCommand(c.program, c.args)) === true;
  });
}

/** A draft for a path change, citing its writes, attribution, and snapshots. */
export function changeDraft(
  ctx: RuleContext,
  change: PathChange,
  fields: { ruleId: RuleId; severity: Severity; title: string; reason: string; subject?: string },
): FindingDraft {
  if (fromGitHistory(ctx, change) && fields.severity !== 'low') {
    fields = {
      ...fields,
      severity: 'low',
      reason: `${fields.reason} It arrived through a git command that brought in existing commits, so it came from the repository's history, not from a file the agent wrote.`,
    };
  }
  const events = change.writes.map((w) => w.event);
  const eventIds = events.map((e) => e.id);
  for (const id of change.attributionEventIds) if (!eventIds.includes(id)) eventIds.push(id);
  const snapshot = change.diff !== null || change.surface !== null;
  const times = events.map((e) => e.ts);
  if (snapshot || times.length === 0) times.push(ctx.snapshotTs);
  return {
    ruleId: fields.ruleId,
    severity: fields.severity,
    title: fields.title,
    reason: fields.reason,
    subject: fields.subject ?? change.key,
    eventIds,
    paths: [change.path],
    artifactIds: [],
    note: snapshot ? 'matched by the start and end snapshots' : null,
    ts: Math.min(...times),
    lastTs: Math.max(...times),
  };
}

/** A draft citing events. */
export function eventDraft(
  events: readonly StoredEvent[],
  fields: Omit<FindingDraft, 'eventIds' | 'paths' | 'artifactIds' | 'note' | 'ts' | 'lastTs'> & {
    paths?: string[];
    artifactIds?: string[];
    note?: string | null;
  },
): FindingDraft {
  const times = events.map((e) => e.ts);
  return {
    ...fields,
    eventIds: events.map((e) => e.id),
    paths: fields.paths ?? [],
    artifactIds: fields.artifactIds ?? [],
    note: fields.note ?? null,
    ts: times.length > 0 ? Math.min(...times) : 0,
    lastTs: times.length > 0 ? Math.max(...times) : 0,
  };
}

/** Effective signals of a kind from tool input (what the agent did, not what it read). */
export function actionSignals(ctx: RuleContext, kind: SignalKind): SignalRecord[] {
  return ctx.signals.filter(
    (s) => s.effective && s.signal.kind === kind && s.signal.source === 'tool.input',
  );
}

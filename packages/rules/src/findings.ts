/**
 * Finding drafts and their finalization: merging drafts with the same rule
 * and subject, the scope check, injection escalation, ids, and ordering.
 */
import {
  pathKey,
  severityRank,
  type Finding,
  type RuleId,
  type Severity,
} from '@stillwatch/schema';
import type { RuleContext } from './context';
import { stableId } from './ids';
import { matchScope } from './scope';
import { pushUnique } from './text';

/** Evidence lists are capped so one noisy rule cannot bloat the analysis. */
const MAX_EVIDENCE = 100;

/** What a rule emits. `lastTs` is the time of the latest evidence. */
export type FindingDraft = {
  ruleId: RuleId;
  severity: Severity;
  title: string;
  reason: string;
  subject: string;
  eventIds: string[];
  paths: string[];
  artifactIds: string[];
  note: string | null;
  ts: number;
  lastTs: number;
};

export type RuleFn = (ctx: RuleContext) => FindingDraft[];

/** Deterministic finding id. */
export function findingId(sessionId: string, ruleId: RuleId, subject: string): string {
  return stableId(sessionId, ruleId, subject);
}

function mergeInto(target: FindingDraft, d: FindingDraft): void {
  if (severityRank(d.severity) > severityRank(target.severity)) {
    target.severity = d.severity;
    target.title = d.title;
    target.reason = d.reason;
  }
  for (const id of d.eventIds)
    if (target.eventIds.length < MAX_EVIDENCE) pushUnique(target.eventIds, id);
  for (const p of d.paths) if (target.paths.length < MAX_EVIDENCE) pushUnique(target.paths, p);
  for (const a of d.artifactIds) pushUnique(target.artifactIds, a);
  target.note ??= d.note;
  target.ts = Math.min(target.ts, d.ts);
  target.lastTs = Math.max(target.lastTs, d.lastTs);
}

type Pending = FindingDraft & { requested: boolean | null };

/** Finding order: severity (high first), then time, then id. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    severityRank(b.severity) - severityRank(a.severity) ||
    a.ts - b.ts ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Turns drafts into findings: merges by rule and subject, applies the scope
 * check (a requested change drops from high to medium), escalates possible
 * prompt injection that a high finding followed, and orders the result.
 */
export function finalizeFindings(ctx: RuleContext, drafts: readonly FindingDraft[]): Finding[] {
  const merged = new Map<string, Pending>();
  for (const d of drafts) {
    const key = `${d.ruleId}\n${d.subject}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, {
        ...d,
        eventIds: d.eventIds.slice(0, MAX_EVIDENCE),
        paths: d.paths.slice(0, MAX_EVIDENCE),
        artifactIds: [...d.artifactIds],
        requested: null,
      });
    } else mergeInto(existing, d);
  }

  const artifactsByKey = new Map<string, string[]>();
  for (const a of ctx.artifacts) {
    const list = artifactsByKey.get(pathKey(a.path)) ?? [];
    list.push(a.id);
    artifactsByKey.set(pathKey(a.path), list);
  }

  const pending = [...merged.values()];
  for (const f of pending) {
    for (const p of f.paths)
      for (const id of artifactsByKey.get(pathKey(p)) ?? []) pushUnique(f.artifactIds, id);
    const keyword = matchScope(f.ruleId, ctx.requests, f.lastTs);
    if (keyword === undefined) continue;
    if (keyword === null) {
      f.requested = false;
      f.reason += ' No user request in this session mentions this kind of change.';
      continue;
    }
    f.requested = true;
    if (f.severity === 'high') {
      f.severity = 'medium';
      f.reason += ` The user's request mentions "${keyword}", so this may have been asked for; severity lowered from high to medium.`;
    } else {
      f.reason += ` The user's request mentions "${keyword}", so this may have been asked for.`;
    }
  }

  escalateInjection(pending);

  return pending
    .map((f): Finding => ({
      id: findingId(ctx.sessionId, f.ruleId, f.subject),
      sessionId: ctx.sessionId,
      ruleId: f.ruleId,
      severity: f.severity,
      title: f.title,
      reason: f.reason,
      subject: f.subject,
      evidence: {
        eventIds: f.eventIds,
        paths: f.paths,
        artifactIds: f.artifactIds,
        note: f.note,
      },
      requested: f.requested,
      ts: f.ts,
    }))
    .sort(compareFindings);
}

/** Possible prompt injection becomes high when a high finding has evidence later in the session. */
function escalateInjection(pending: Pending[]): void {
  const highs = pending.filter(
    (f) => f.severity === 'high' && f.ruleId !== 'prompt_injection.possible',
  );
  for (const f of pending) {
    if (f.ruleId !== 'prompt_injection.possible') continue;
    const later = highs
      .filter((h) => h.lastTs > f.ts)
      .sort((a, b) => a.ts - b.ts || (a.subject < b.subject ? -1 : 1))[0];
    if (later === undefined) continue;
    f.severity = 'high';
    f.reason += ` A high-severity finding has evidence later in the session ("${later.title}"), so the injected text may have steered the agent.`;
    for (const id of later.eventIds.slice(0, 5)) pushUnique(f.eventIds, id);
  }
}

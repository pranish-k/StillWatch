/**
 * RuleContext: everything rules need, computed once per analysis in a single
 * pass over the events. Every relevant path is classified exactly once here,
 * through an injected classifier, so each rule is a pure function of the
 * context and tests can build contexts with a fake classifier.
 */
import {
  pathKey,
  type AnalysisInput,
  type Artifact,
  type Attribution,
  type DomainRecord,
  type EventKind,
  type FileAccess,
  type FileChange,
  type PathClass,
  type PathClassification,
  type RawFileChange,
  type Signal,
  type StoredEvent,
  type ToolCall,
  type ToolCategory,
} from '@stillwatch/schema';
import { buildArtifacts } from './artifacts';
import { buildFileChanges, buildPathChanges } from './attribution';
import { buildDomainRecords, buildNetworkCalls } from './domains';

export type Classify = (path: string) => PathClassification;

export type EventOf<K extends EventKind> = Extract<StoredEvent, { kind: K }>;

/** One tool call, assembled from its tool.pre, result, and permission events. */
export type ToolCallGroup = {
  /** Tool use id, or `event:<id>` when the agent gave none. */
  key: string;
  tool: ToolCall;
  category: ToolCategory;
  pre: StoredEvent | null;
  post: StoredEvent | null;
  failure: StoredEvent | null;
  denied: StoredEvent | null;
  resolvedByBatch: boolean;
  /** Earliest event of the call. */
  first: StoredEvent;
  /** The event whose facts represent the call (result when present, else the call). */
  primary: StoredEvent;
  /**
   * The call ran with effect: not denied, and not a failed file tool. A failed
   * shell command still counts, because part of a command line may have run.
   */
  effective: boolean;
};

export type AccessRecord = {
  event: StoredEvent;
  /** Position of the event in `events`. */
  index: number;
  access: FileAccess;
  key: string;
  classification: PathClassification;
  effective: boolean;
};

export type SignalRecord = {
  event: StoredEvent;
  index: number;
  signal: Signal;
  effective: boolean;
};

export type SnapshotChange = {
  change: 'created' | 'modified' | 'deleted';
  kind: 'file' | 'dir' | 'command';
  hashAfter: string | null;
  label: string;
};

/** Everything known about one changed path: writes the session made and what snapshots saw. */
export type PathChange = {
  path: string;
  key: string;
  classes: PathClass[];
  label: string | null;
  /** Effective write, delete, and chmod accesses, in event order. */
  writes: AccessRecord[];
  diff: RawFileChange | null;
  surface: SnapshotChange | null;
  /** Inside a repository the start and end snapshots compared. */
  inSnapshottedRepo: boolean;
  attribution: Attribution;
  attributionEventIds: string[];
};

/** A tool call that can reach the network, with the domains its input names. */
export type NetworkCall = {
  group: ToolCallGroup;
  /** The counted event of the call. */
  event: StoredEvent;
  index: number;
  domains: string[];
  /** Tool name or program per domain. */
  via: Map<string, string[]>;
  effective: boolean;
};

export type UserRequest = { eventId: string; ts: number; text: string };

export type RuleContext = {
  input: AnalysisInput;
  sessionId: string;
  events: readonly StoredEvent[];
  /** Index of each event id in `events`. */
  indexOf: ReadonlyMap<string, number>;
  /** Classification of a path (memoized by path key). */
  classOf: (path: string) => PathClassification;
  calls: ToolCallGroup[];
  callOf: ReadonlyMap<string, ToolCallGroup>;
  /** Events whose facts count, so one tool call contributes its facts once. */
  counted: { event: StoredEvent; index: number; effective: boolean }[];
  accesses: AccessRecord[];
  signals: SignalRecord[];
  pathChanges: PathChange[];
  fileChanges: FileChange[];
  artifacts: Artifact[];
  networkCalls: NetworkCall[];
  domains: DomainRecord[];
  /** User-typed prompts and prompt expansions, the basis of scope checks. */
  requests: UserRequest[];
  lastTurnStop: EventOf<'turn.stop'> | null;
  /** Time used for evidence that only snapshots provide. */
  snapshotTs: number;
};

/** Groups tool events by tool use id. */
export function groupToolCalls(events: readonly StoredEvent[]): {
  calls: ToolCallGroup[];
  callOf: Map<string, ToolCallGroup>;
} {
  type Draft = Omit<ToolCallGroup, 'primary' | 'effective' | 'resolvedByBatch'>;
  const byKey = new Map<string, Draft>();
  const byEvent = new Map<string, Draft>();
  const order: Draft[] = [];
  const batchResolved = new Set<string>();
  for (const event of events) {
    if (event.kind === 'tool.batch') {
      for (const item of event.data.calls) {
        if (item.toolUseId !== null) batchResolved.add(item.toolUseId);
      }
      continue;
    }
    const tool = event.tool;
    if (tool === null) continue;
    const kind = event.kind;
    if (
      kind !== 'tool.pre' &&
      kind !== 'tool.post' &&
      kind !== 'tool.failure' &&
      kind !== 'permission.denied'
    ) {
      continue;
    }
    const key = tool.useId ?? `event:${event.id}`;
    let draft = byKey.get(key);
    if (draft === undefined) {
      draft = {
        key,
        tool,
        category: tool.category,
        pre: null,
        post: null,
        failure: null,
        denied: null,
        first: event,
      };
      byKey.set(key, draft);
      order.push(draft);
    }
    if (kind === 'tool.pre') draft.pre ??= event;
    else if (kind === 'tool.post') draft.post ??= event;
    else if (kind === 'tool.failure') draft.failure ??= event;
    else draft.denied ??= event;
    byEvent.set(event.id, draft);
  }
  const done = new Map<Draft, ToolCallGroup>();
  const calls = order.map((d) => {
    const effective =
      d.denied === null &&
      (d.post !== null || (d.failure !== null ? d.category === 'shell' : true));
    const group: ToolCallGroup = {
      ...d,
      tool: d.post?.tool ?? d.pre?.tool ?? d.tool,
      primary: d.post ?? d.failure ?? d.pre ?? d.first,
      resolvedByBatch: batchResolved.has(d.key),
      effective,
    };
    done.set(d, group);
    return group;
  });
  const callOf = new Map<string, ToolCallGroup>();
  for (const [id, draft] of byEvent) {
    const group = done.get(draft);
    if (group !== undefined) callOf.set(id, group);
  }
  return { calls, callOf };
}

/** Whether an event's facts count (avoids counting a tool call's input twice). */
function isCounted(event: StoredEvent, group: ToolCallGroup | undefined): boolean {
  if (event.kind === 'tool.pre') {
    return group === undefined || (group.post === null && group.failure === null);
  }
  return (
    event.kind !== 'permission.request' &&
    event.kind !== 'permission.denied' &&
    event.kind !== 'tool.batch'
  );
}

/** Builds the rule context. `classify` is called once per distinct path key. */
export function buildContext(input: AnalysisInput, classify: Classify): RuleContext {
  const memo = new Map<string, PathClassification>();
  const classOf = (path: string): PathClassification => {
    const key = pathKey(path);
    let found = memo.get(key);
    if (found === undefined) {
      found = classify(path);
      memo.set(key, found);
    }
    return found;
  };

  const events = input.events;
  const indexOf = new Map<string, number>();
  events.forEach((e, i) => indexOf.set(e.id, i));
  const { calls, callOf } = groupToolCalls(events);

  const counted: RuleContext['counted'] = [];
  const accesses: AccessRecord[] = [];
  const signals: SignalRecord[] = [];
  const requests: UserRequest[] = [];
  let lastTurnStop: EventOf<'turn.stop'> | null = null;

  events.forEach((event, index) => {
    if (event.kind === 'turn.stop') lastTurnStop = event;
    if (event.kind === 'prompt.submit' && event.data.origin === 'user') {
      requests.push({ eventId: event.id, ts: event.ts, text: event.data.prompt });
    }
    if (event.kind === 'prompt.expand') {
      const d = event.data;
      const text = [d.prompt, d.commandName, d.commandArgs].filter((s) => s !== null).join(' ');
      if (text !== '') requests.push({ eventId: event.id, ts: event.ts, text });
    }
    const group = callOf.get(event.id);
    if (!isCounted(event, group)) return;
    const effective = group === undefined ? true : group.effective;
    counted.push({ event, index, effective });
    const seen = new Set<string>();
    const add = (access: FileAccess): void => {
      const key = pathKey(access.path);
      const dedupe = `${key}\n${access.op}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      accesses.push({ event, index, access, key, classification: classOf(access.path), effective });
    };
    for (const access of event.facts.files) add(access);
    if (event.kind === 'tool.post' && event.tool !== null) {
      for (const path of event.tool.changedFiles) {
        add({ path, op: 'write', via: 'agent-report', detail: 'bashEditDiff', unresolved: false });
      }
    }
    for (const signal of event.facts.signals) signals.push({ event, index, signal, effective });
  });

  const snapshotTs = input.end?.takenAt ?? input.now;
  const pathChanges = buildPathChanges(input, accesses, counted, classOf);
  const fileChanges = buildFileChanges(input, pathChanges);
  const networkCalls = buildNetworkCalls(calls, indexOf);
  const domains = buildDomainRecords(input, networkCalls);
  const base = {
    input,
    sessionId: input.session.id,
    events,
    indexOf,
    classOf,
    calls,
    callOf,
    counted,
    accesses,
    signals,
    pathChanges,
    fileChanges,
    networkCalls,
    domains,
    requests,
    lastTurnStop: lastTurnStop as EventOf<'turn.stop'> | null,
    snapshotTs,
  };
  return { ...base, artifacts: buildArtifacts(base) };
}

/**
 * Converts raw Claude Code hook payloads (spool records) into `NormalizedEvent`.
 */
import {
  LIMITS,
  newId as defaultNewId,
  toJsonValue,
  type BackgroundTask,
  type EventBase,
  type EventPayload,
  type JsonObject,
  type JsonValue,
  type NormalizedEvent,
  type SessionCron,
  type ToolBatchItem,
  type ToolCall,
} from '@stillwatch/schema';
import {
  asArray,
  asObject,
  bool,
  boundedJson,
  cleanId,
  sliceChars,
  str,
  strList,
  textOf,
} from './json';
import { promptOrigin } from './prompt';
import { buildToolCall, UNKNOWN_TOOL, type ToolEventKind } from './tools';

/** One spool file, as read by the collector. */
export type SpoolRecord = {
  /** Spool file name; unique. Becomes `NormalizedEvent.sourceId`. */
  sourceId: string;
  /** Event name from the file name. Untrusted; used only when the payload lacks `hook_event_name`. */
  eventHint: string | null;
  /** File modification time, epoch milliseconds (fractional). Becomes `NormalizedEvent.ts`. */
  receivedAt: number;
  /** Raw payload text exactly as the hook received it on stdin. */
  body: string;
};

export type AdaptResult =
  { ok: true; event: NormalizedEvent } | { ok: false; reason: string; sessionId: string | null };

export type AdaptOptions = {
  /** Id generator, default `newId` from @stillwatch/schema. */
  newId?: (ts: number) => string;
};

/** Fields every hook payload may carry; they are not repeated in `unknown` data. */
const COMMON_FIELDS: ReadonlySet<string> = new Set([
  'session_id',
  'prompt_id',
  'transcript_path',
  'cwd',
  'scratchpad_dir',
  'permission_mode',
  'effort',
  'hook_event_name',
  'agent_id',
  'agent_type',
]);

const EVENT_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const PREVIEW_CHARS = 200;
const MAX_ITEMS = LIMITS.maxArrayItems;
const MAX_DETAIL_JSON = 4_000;
const SALVAGE_SCAN_CHARS = 65_536;
// Control characters are rejected afterwards by cleanId.
const SALVAGE_PATTERN = /"session_id"\s{0,16}:\s{0,16}"([^"\\]{1,256})"/;

function fail(reason: string, sessionId: string | null): AdaptResult {
  return { ok: false, reason, sessionId };
}

/** Best-effort session id from raw text, so a failed record can still be attributed. */
function salvageSessionId(body: string): string | null {
  const match = SALVAGE_PATTERN.exec(body.slice(0, SALVAGE_SCAN_CHARS));
  return match ? cleanId(match[1]) : null;
}

function exceedsRecordLimit(body: string): boolean {
  if (body.length > LIMITS.maxRecordBytes) return true;
  if (body.length * 3 <= LIMITS.maxRecordBytes) return false;
  return Buffer.byteLength(body, 'utf8') > LIMITS.maxRecordBytes;
}

function eventName(payload: JsonObject, hint: string | null): string {
  const fromPayload = str(payload, 'hook_event_name');
  if (fromPayload !== null && EVENT_NAME.test(fromPayload)) return fromPayload;
  if (hint !== null && EVENT_NAME.test(hint)) return hint;
  return 'Unknown';
}

function preview(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return sliceChars(value, PREVIEW_CHARS);
  const list = asArray(value);
  if (list !== null) {
    for (const item of list) {
      if (typeof item === 'string') return sliceChars(item, PREVIEW_CHARS);
      const block = asObject(item);
      const text = str(block, 'text');
      if (text !== null) return sliceChars(text, PREVIEW_CHARS);
    }
  }
  return boundedJson(value, PREVIEW_CHARS);
}

function objects(value: JsonValue | undefined): JsonObject[] {
  const list = asArray(value);
  if (list === null) return [];
  const out: JsonObject[] = [];
  for (const item of list) {
    if (out.length >= MAX_ITEMS) break;
    const obj = asObject(item);
    if (obj !== null) out.push(obj);
  }
  return out;
}

function batchCalls(payload: JsonObject): ToolBatchItem[] {
  return objects(payload.tool_calls).map((call) => {
    const name = str(call, 'tool_name');
    return {
      toolUseId: cleanId(call.tool_use_id),
      toolName: name !== null && name.length > 0 ? name : UNKNOWN_TOOL,
      resultPreview: preview(call.tool_response),
    };
  });
}

function backgroundTasks(payload: JsonObject): BackgroundTask[] {
  return objects(payload.background_tasks).map((task) => ({
    id: str(task, 'id') ?? '',
    type: str(task, 'type'),
    status: str(task, 'status'),
    description: str(task, 'description'),
    command: str(task, 'command'),
  }));
}

function sessionCrons(payload: JsonObject): SessionCron[] {
  return objects(payload.session_crons).map((cron) => ({
    id: str(cron, 'id') ?? '',
    schedule: str(cron, 'schedule'),
    recurring: bool(cron, 'recurring'),
    prompt: str(cron, 'prompt'),
  }));
}

function taskData(payload: JsonObject): {
  taskId: string;
  subject: string | null;
  description: string | null;
  teammateName: string | null;
} {
  return {
    taskId: str(payload, 'task_id') ?? '',
    subject: str(payload, 'task_subject'),
    description: str(payload, 'task_description'),
    teammateName: str(payload, 'teammate_name'),
  };
}

function rawData(payload: JsonObject): JsonObject {
  const raw: JsonObject = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!COMMON_FIELDS.has(key)) raw[key] = value;
  }
  return raw;
}

type Shaped = {
  part: EventPayload;
  tool: ToolCall | null;
  /** True for events that fire in the parent's context about a subagent. */
  parentContext: boolean;
};

function toolEvent(payload: JsonObject, kind: ToolEventKind, part: EventPayload): Shaped {
  return { part, tool: buildToolCall(payload, kind), parentContext: false };
}

function plain(part: EventPayload): Shaped {
  return { part, tool: null, parentContext: false };
}

function shape(name: string, p: JsonObject): Shaped {
  switch (name) {
    case 'SessionStart':
      return plain({
        kind: 'session.start',
        data: {
          source: str(p, 'source'),
          model: str(p, 'model'),
          sessionTitle: str(p, 'session_title'),
        },
      });
    case 'SessionEnd':
      return plain({ kind: 'session.end', data: { reason: str(p, 'reason') } });
    case 'UserPromptSubmit': {
      const prompt = str(p, 'prompt') ?? '';
      return plain({
        kind: 'prompt.submit',
        data: { prompt, origin: promptOrigin(prompt), sessionTitle: str(p, 'session_title') },
      });
    }
    case 'UserPromptExpansion':
      return plain({
        kind: 'prompt.expand',
        data: {
          expansionType: str(p, 'expansion_type'),
          commandName: str(p, 'command_name'),
          commandArgs: str(p, 'command_args'),
          commandSource: str(p, 'command_source'),
          prompt: str(p, 'prompt'),
        },
      });
    case 'PreToolUse':
      return toolEvent(p, 'tool.pre', { kind: 'tool.pre', data: {} });
    case 'PostToolUse':
      return toolEvent(p, 'tool.post', { kind: 'tool.post', data: {} });
    case 'PostToolUseFailure':
      return toolEvent(p, 'tool.failure', { kind: 'tool.failure', data: {} });
    case 'PostToolBatch':
      return plain({ kind: 'tool.batch', data: { calls: batchCalls(p) } });
    case 'PermissionRequest':
      return toolEvent(p, 'permission.request', {
        kind: 'permission.request',
        data: { suggestions: p.permission_suggestions ?? null },
      });
    case 'PermissionDenied':
      return toolEvent(p, 'permission.denied', {
        kind: 'permission.denied',
        data: { reason: str(p, 'reason') },
      });
    case 'SubagentStart':
      return {
        part: {
          kind: 'subagent.start',
          data: { subagentId: cleanId(p.agent_id) ?? '', subagentType: str(p, 'agent_type') },
        },
        tool: null,
        parentContext: true,
      };
    case 'SubagentStop':
      return {
        part: {
          kind: 'subagent.stop',
          data: {
            subagentId: cleanId(p.agent_id) ?? '',
            subagentType: str(p, 'agent_type'),
            transcriptPath: str(p, 'agent_transcript_path'),
            lastMessage: str(p, 'last_assistant_message'),
          },
        },
        tool: null,
        parentContext: true,
      };
    case 'TaskCreated':
      return plain({ kind: 'task.created', data: taskData(p) });
    case 'TaskCompleted':
      return plain({ kind: 'task.completed', data: taskData(p) });
    case 'Stop':
      return plain({
        kind: 'turn.stop',
        data: {
          lastMessage: str(p, 'last_assistant_message'),
          backgroundTasks: backgroundTasks(p),
          sessionCrons: sessionCrons(p),
          stopHookActive: bool(p, 'stop_hook_active'),
        },
      });
    case 'StopFailure':
      return plain({
        kind: 'turn.failure',
        data: {
          error: textOf(p.error, MAX_DETAIL_JSON),
          errorDetails: textOf(p.error_details, MAX_DETAIL_JSON),
          lastMessage: str(p, 'last_assistant_message'),
        },
      });
    case 'InstructionsLoaded':
      return plain({
        kind: 'instructions.loaded',
        data: {
          filePath: str(p, 'file_path') ?? '',
          memoryType: str(p, 'memory_type'),
          loadReason: str(p, 'load_reason'),
          globs: strList(p, 'globs', MAX_ITEMS),
          triggerFilePath: str(p, 'trigger_file_path'),
          parentFilePath: str(p, 'parent_file_path'),
        },
      });
    case 'ConfigChange':
      return plain({
        kind: 'config.change',
        data: { source: str(p, 'source'), filePath: str(p, 'file_path') },
      });
    case 'CwdChanged':
      return plain({
        kind: 'cwd.change',
        data: { oldCwd: str(p, 'old_cwd'), newCwd: str(p, 'new_cwd') },
      });
    case 'DirectoryAdded':
      return plain({
        kind: 'directory.add',
        data: { directory: str(p, 'directory') ?? '', source: str(p, 'source') },
      });
    case 'FileChanged':
      return plain({
        kind: 'file.change',
        data: { filePath: str(p, 'file_path') ?? '', change: str(p, 'event') },
      });
    case 'PreCompact':
      return plain({
        kind: 'compact.pre',
        data: { trigger: str(p, 'trigger'), customInstructions: str(p, 'custom_instructions') },
      });
    case 'PostCompact':
      return plain({
        kind: 'compact.post',
        data: { trigger: str(p, 'trigger'), summary: str(p, 'compact_summary') },
      });
    case 'PreModelSwitch':
    case 'PostModelSwitch':
      return plain({
        kind: 'model.switch',
        data: {
          fromModel: str(p, 'from_model'),
          toModel: str(p, 'to_model'),
          source: str(p, 'source'),
        },
      });
    case 'Notification':
      return plain({
        kind: 'notification',
        data: {
          notificationType: str(p, 'notification_type'),
          title: str(p, 'title'),
          message: str(p, 'message'),
        },
      });
    default:
      return plain({ kind: 'unknown', data: { raw: rawData(p) } });
  }
}

function adapt(record: SpoolRecord, options: AdaptOptions): AdaptResult {
  const body = record.body;
  if (typeof body !== 'string') return fail('record body is not text', null);
  if (exceedsRecordLimit(body)) {
    return fail(`record is larger than ${LIMITS.maxRecordBytes} bytes`, salvageSessionId(body));
  }
  if (!Number.isFinite(record.receivedAt))
    return fail('record has no valid receive time', salvageSessionId(body));
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fail('payload is not valid JSON', salvageSessionId(body));
  }
  const payload = asObject(toJsonValue(parsed, LIMITS.maxJsonDepth));
  if (payload === null) return fail('payload is not a JSON object', null);
  const sessionId = cleanId(payload.session_id);
  if (sessionId === null) return fail('payload has no valid session_id', null);

  const sourceEvent = eventName(payload, record.eventHint);
  const shaped = shape(sourceEvent, payload);
  const ts = record.receivedAt;
  const base: EventBase = {
    id: (options.newId ?? defaultNewId)(ts),
    sourceId: record.sourceId,
    agent: 'claude-code',
    sessionId,
    agentId: shaped.parentContext ? null : cleanId(payload.agent_id),
    agentType: shaped.parentContext ? null : str(payload, 'agent_type'),
    promptId: cleanId(payload.prompt_id),
    sourceEvent,
    ts,
    cwd: str(payload, 'cwd'),
    permissionMode: str(payload, 'permission_mode'),
    transcriptPath: str(payload, 'transcript_path'),
    tool: shaped.tool,
  };
  return { ok: true, event: { ...base, ...shaped.part } };
}

/**
 * Converts one Claude Code hook payload into a `NormalizedEvent`.
 * Never throws: malformed input gives `{ ok: false }` with a reason, plus the
 * session id when one could be salvaged (so the gap can be attributed).
 * Unknown event names map to kind `unknown` and keep the payload in `data.raw`.
 * Does not redact or truncate; the collector does that next.
 */
export function adaptClaudeRecord(record: SpoolRecord, options?: AdaptOptions): AdaptResult {
  try {
    return adapt(record, options ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const body = typeof record.body === 'string' ? record.body : '';
    return fail(`adapter error: ${sliceChars(message, 200)}`, salvageSessionId(body));
  }
}

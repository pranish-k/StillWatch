/**
 * Claude Code tool knowledge: categories, and minimizing tool results before
 * storage (file tools embed whole file contents; Stillwatch keeps previews).
 */
import type {
  JsonObject,
  JsonValue,
  McpServerInfo,
  ToolCall,
  ToolCategory,
} from '@stillwatch/schema';
import { asArray, asObject, bool, cleanId, num, str, textOf } from './json';

const CATEGORY_BY_NAME: ReadonlyMap<string, ToolCategory> = new Map<string, ToolCategory>([
  ['Bash', 'shell'],
  ['PowerShell', 'shell'],
  ['BashOutput', 'shell'],
  ['KillShell', 'shell'],
  ['KillBash', 'shell'],
  ['Read', 'file.read'],
  ['Write', 'file.write'],
  ['Edit', 'file.edit'],
  ['MultiEdit', 'file.edit'],
  ['NotebookEdit', 'notebook'],
  ['NotebookRead', 'notebook'],
  ['Glob', 'file.search'],
  ['Grep', 'file.search'],
  ['LS', 'file.search'],
  ['WebFetch', 'web.fetch'],
  ['WebSearch', 'web.search'],
  ['Agent', 'agent'],
  ['Task', 'agent'],
  ['SubagentHandback', 'agent'],
  ['TaskCreate', 'task'],
  ['TaskUpdate', 'task'],
  ['TaskGet', 'task'],
  ['TaskList', 'task'],
  ['TaskOutput', 'task'],
  ['TaskStop', 'task'],
  ['TodoWrite', 'task'],
  ['CronCreate', 'task'],
  ['CronDelete', 'task'],
  ['ScheduleWakeup', 'task'],
  ['EnterPlanMode', 'plan'],
  ['ExitPlanMode', 'plan'],
  ['AskUserQuestion', 'question'],
]);

/** Maps a Claude Code tool name to a category. `mcp__*` tools are `mcp`. */
export function classifyClaudeTool(name: string): ToolCategory {
  const known = CATEGORY_BY_NAME.get(name);
  if (known !== undefined) return known;
  if (name.startsWith('mcp__')) return 'mcp';
  return 'other';
}

/** Placeholder name when a tool event carries no usable tool name. */
export const UNKNOWN_TOOL = 'Unknown';
const MAX_TOOL_NAME = 256;
const MAX_CHANGED_FILES = 200;
const MAX_ERROR_JSON = 4_000;
const FILE_CATEGORIES: ReadonlySet<ToolCategory> = new Set([
  'file.read',
  'file.write',
  'file.edit',
  'notebook',
]);
const BULKY_KEYS = ['originalFile', 'structuredPatch'];

export type ToolEventKind =
  'tool.pre' | 'tool.post' | 'tool.failure' | 'permission.request' | 'permission.denied';

function toolName(payload: JsonObject): string {
  const name = str(payload, 'tool_name');
  if (name === null || name.length === 0 || name.length > MAX_TOOL_NAME) return UNKNOWN_TOOL;
  return name;
}

function changedFilesOf(response: JsonObject | null): string[] {
  const diff = asObject(response?.bashEditDiff);
  const list = asArray(diff?.changedFiles);
  if (list === null) return [];
  const out: string[] = [];
  for (const item of list) {
    if (out.length >= MAX_CHANGED_FILES) break;
    if (typeof item === 'string' && item.length > 0) out.push(item);
  }
  return out;
}

function mcpServerOf(payload: JsonObject, name: string): McpServerInfo | null {
  const server = asObject(payload.mcp_server);
  if (server !== null) return { name: str(server, 'name') ?? '', source: str(server, 'source') };
  if (name.startsWith('mcp__')) {
    const rest = name.slice('mcp__'.length);
    const end = rest.indexOf('__');
    const serverName = end === -1 ? rest : rest.slice(0, end);
    if (serverName.length > 0) return { name: serverName, source: null };
  }
  return null;
}

function withoutBulky(value: JsonValue): JsonValue {
  const obj = asObject(value);
  if (obj === null) return value;
  if (!BULKY_KEYS.some((key) => key in obj)) return obj;
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(obj)) {
    if (!BULKY_KEYS.includes(key)) out[key] = item;
  }
  return out;
}

function minimizeBash(response: JsonObject): JsonObject {
  const isImage = bool(response, 'isImage');
  const diff = asObject(response.bashEditDiff);
  return {
    // Image output is base64 data: never useful as text and often large.
    stdout: isImage === true ? null : str(response, 'stdout'),
    stderr: str(response, 'stderr'),
    interrupted: bool(response, 'interrupted'),
    isImage,
    bashEditDiff:
      diff === null
        ? null
        : {
            changedFiles: changedFilesOf(response),
            moreFiles: num(diff, 'moreFiles'),
            unavailable: bool(diff, 'unavailable'),
            skipped: bool(diff, 'skipped'),
            shared: bool(diff, 'shared'),
          },
  };
}

/**
 * Reduces a PostToolUse `tool_response` to what Stillwatch keeps. Never keeps
 * `originalFile` or `structuredPatch`; file content stays only for Read
 * (facts scan it before the collector truncates it).
 */
export function minimizeToolResponse(name: string, raw: JsonValue | undefined): JsonValue | null {
  if (raw === undefined) return null;
  const response = asObject(raw);
  switch (name) {
    case 'Read': {
      if (response === null) {
        return {
          type: null,
          filePath: null,
          numLines: null,
          startLine: null,
          totalLines: null,
          content: typeof raw === 'string' ? raw : null,
        };
      }
      const file = asObject(response.file);
      return {
        type: str(response, 'type'),
        filePath: str(file, 'filePath') ?? str(response, 'filePath'),
        numLines: num(file, 'numLines'),
        startLine: num(file, 'startLine'),
        totalLines: num(file, 'totalLines'),
        content: str(file, 'content'),
      };
    }
    case 'Write':
      return response === null
        ? null
        : { type: str(response, 'type'), filePath: str(response, 'filePath') };
    case 'Edit':
    case 'MultiEdit':
      return response === null
        ? null
        : {
            filePath: str(response, 'filePath'),
            replaceAll: bool(response, 'replaceAll'),
            userModified: bool(response, 'userModified'),
          };
    case 'Bash':
    case 'PowerShell':
      return response === null ? withoutBulky(raw) : minimizeBash(response);
    case 'Agent':
      return response === null
        ? withoutBulky(raw)
        : {
            status: str(response, 'status'),
            agentId: str(response, 'agentId'),
            resolvedModel: str(response, 'resolvedModel'),
            totalDurationMs: num(response, 'totalDurationMs'),
            totalToolUseCount: num(response, 'totalToolUseCount'),
            totalTokens: num(response, 'totalTokens'),
            content: response.content ?? null,
          };
    case 'ExitPlanMode':
      return response === null
        ? withoutBulky(raw)
        : { plan: str(response, 'plan'), filePath: str(response, 'filePath') };
    default:
      return withoutBulky(raw);
  }
}

/** Builds the `ToolCall` for a tool or permission event. */
export function buildToolCall(payload: JsonObject, kind: ToolEventKind): ToolCall {
  const name = toolName(payload);
  const category = classifyClaudeTool(name);
  const input = asObject(payload.tool_input) ?? {};
  const rawResponse = payload.tool_response;
  const isPost = kind === 'tool.post';
  const isFailure = kind === 'tool.failure';
  const filePath = FILE_CATEGORIES.has(category)
    ? (str(input, 'file_path') ?? str(input, 'notebook_path'))
    : null;
  return {
    name,
    useId: kind === 'permission.request' ? null : cleanId(payload.tool_use_id),
    category,
    input,
    response: isPost ? minimizeToolResponse(name, rawResponse) : null,
    error: isFailure ? textOf(payload.error, MAX_ERROR_JSON) : null,
    isInterrupt: isFailure ? bool(payload, 'is_interrupt') : null,
    durationMs: num(payload, 'duration_ms'),
    mcpServer: mcpServerOf(payload, name),
    filePath,
    url: name === 'WebFetch' ? str(input, 'url') : null,
    command: name === 'Bash' || name === 'PowerShell' ? str(input, 'command') : null,
    sandboxDisabled: input.dangerouslyDisableSandbox === true,
    runInBackground: input.run_in_background === true,
    changedFiles: isPost ? changedFilesOf(asObject(rawResponse)) : [],
  };
}

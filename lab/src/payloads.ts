/**
 * Builders for realistic Claude Code hook payloads, in the exact shapes seen
 * in `lab/fixtures/claude-code/real-session-2.1.318.json`, and a small script
 * recorder that turns a simulated session into lab steps.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { JsonObject, JsonValue } from '@stillwatch/schema';
import type { FileEffect, HookPayload, ScenarioPlan, SessionRef, Step, World } from './types';

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function randomChars(count: number, alphabet: string = BASE62): string {
  const bytes = randomBytes(count);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length] ?? '';
  return out;
}

export function newToolUseId(): string {
  return `toolu_01${randomChars(22)}`;
}

export function newAgentId(): string {
  return `a${randomBytes(8).toString('hex')}`;
}

/**
 * A fake AWS access key id, built at runtime so no real-looking secret is
 * ever written in the repository.
 */
export function fakeAwsAccessKeyId(): string {
  return ['AK', 'IA'].join('') + randomChars(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
}

/** Claude Code's project directory slug for a cwd: every non-alphanumeric character becomes "-". */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export function transcriptPath(home: string, cwd: string, sessionId: string): string {
  return `${home}/.claude/projects/${projectSlug(cwd)}/${sessionId}.jsonl`;
}

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

export type ToolCall = {
  name: string;
  input: JsonObject;
  response: JsonValue;
  /** The plain-text rendering PostToolBatch carries for this call. */
  batchText: string;
  durationMs: number;
};

function numbered(content: string): string {
  const lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line, i) => `${i + 1}\t${line}`).join('\n');
}

function lineCount(content: string): number {
  return content.split('\n').length;
}

export function readCall(filePath: string, content: string): ToolCall {
  const lines = lineCount(content);
  return {
    name: 'Read',
    input: { file_path: filePath },
    response: {
      type: 'text',
      file: { filePath, content, numLines: lines, startLine: 1, totalLines: lines },
    },
    batchText: numbered(content),
    durationMs: 2,
  };
}

export function writeCall(
  filePath: string,
  content: string,
  originalFile: string | null,
): ToolCall {
  return {
    name: 'Write',
    input: { file_path: filePath, content },
    response: {
      type: originalFile === null ? 'create' : 'update',
      filePath,
      content,
      structuredPatch: [],
      originalFile,
      userModified: false,
    },
    batchText:
      originalFile === null
        ? `File created successfully at: ${filePath}`
        : `The file ${filePath} has been updated successfully.`,
    durationMs: 3,
  };
}

/** A single-hunk structured patch replacing `oldString` with `newString` in `originalFile`. */
export function structuredPatch(
  originalFile: string,
  oldString: string,
  newString: string,
): JsonObject[] {
  const index = originalFile.indexOf(oldString);
  if (index === -1) return [];
  const start = originalFile.slice(0, index).split('\n').length;
  const oldLines = oldString.replace(/\n$/, '').split('\n');
  const newLines = newString.replace(/\n$/, '').split('\n');
  return [
    {
      oldStart: start,
      oldLines: oldLines.length,
      newStart: start,
      newLines: newLines.length,
      lines: [...oldLines.map((l) => `-${l}`), ...newLines.map((l) => `+${l}`)],
    },
  ];
}

export function editCall(
  filePath: string,
  oldString: string,
  newString: string,
  originalFile: string | null,
): ToolCall {
  return {
    name: 'Edit',
    input: {
      file_path: filePath,
      old_string: oldString,
      new_string: newString,
      replace_all: false,
    },
    response: {
      filePath,
      oldString,
      newString,
      originalFile,
      structuredPatch:
        originalFile === null ? [] : structuredPatch(originalFile, oldString, newString),
      userModified: false,
      replaceAll: false,
    },
    batchText: `The file ${filePath} has been updated successfully.`,
    durationMs: 4,
  };
}

/** Applies an Edit to file text, as Claude Code would; throws when `oldString` is absent. */
export function applyEdit(original: string, oldString: string, newString: string): string {
  const index = original.indexOf(oldString);
  if (index === -1) throw new Error('edit: old string not found');
  return original.slice(0, index) + newString + original.slice(index + oldString.length);
}

export function bashCall(
  command: string,
  description: string,
  stdout: string,
  options: { sandboxDisabled?: boolean; stderr?: string } = {},
): ToolCall {
  const input: JsonObject = { command, description };
  if (options.sandboxDisabled === true) input.dangerouslyDisableSandbox = true;
  const stderr = options.stderr ?? '';
  return {
    name: 'Bash',
    input,
    response: { stdout, stderr, interrupted: false, isImage: false, noOutputExpected: false },
    batchText: stderr === '' ? stdout : `${stdout}\n${stderr}`,
    durationMs: 180,
  };
}

export function webFetchCall(url: string, prompt: string, result: string): ToolCall {
  return {
    name: 'WebFetch',
    input: { url, prompt },
    response: {
      bytes: 48_213,
      code: 200,
      codeText: 'OK',
      result,
      durationMs: 1_840,
      url,
    },
    batchText: result,
    durationMs: 1_850,
  };
}

export function globCall(pattern: string, path: string, filenames: string[]): ToolCall {
  return {
    name: 'Glob',
    input: { pattern, path },
    response: {
      filenames,
      durationMs: 12,
      numFiles: filenames.length,
      truncated: false,
      totalMatches: filenames.length,
      countIsComplete: true,
    },
    batchText: filenames.join('\n'),
    durationMs: 12,
  };
}

export type SubagentRef = { id: string; type: string };

export function agentCall(
  description: string,
  prompt: string,
  agent: SubagentRef,
  report: string,
): ToolCall {
  return {
    name: 'Agent',
    input: { description, prompt, subagent_type: agent.type },
    response: {
      status: 'completed',
      prompt,
      agentId: agent.id,
      content: [{ type: 'text', text: report }],
      totalDurationMs: 9_400,
      totalTokens: 18_220,
      totalToolUseCount: 2,
    },
    batchText: report,
    durationMs: 9_400,
  };
}

// ---------------------------------------------------------------------------
// Sessions and scripts
// ---------------------------------------------------------------------------

/** Records the steps of one scenario. */
export class Script {
  readonly steps: Step[] = [];
  readonly setupEffects: FileEffect[] = [];
  readonly sessions: SessionRef[] = [];
  readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  session(key = 'main', options: { cwd?: string; permissionMode?: string } = {}): ClaudeSession {
    if (this.sessions.some((s) => s.key === key)) throw new Error(`duplicate session key: ${key}`);
    const session = new ClaudeSession(this, key, randomUUID(), {
      cwd: options.cwd ?? this.world.repo,
      permissionMode: options.permissionMode ?? 'acceptEdits',
    });
    this.sessions.push({ key, id: session.id });
    return session;
  }

  setup(...effects: FileEffect[]): this {
    this.setupEffects.push(...effects);
    return this;
  }

  hook(payload: HookPayload): this {
    this.steps.push({ kind: 'hook', event: payload.hook_event_name, payload });
    return this;
  }

  effect(...effects: FileEffect[]): this {
    for (const effect of effects) this.steps.push({ kind: 'effect', effect });
    return this;
  }

  import(): this {
    this.steps.push({ kind: 'import' });
    return this;
  }

  analyze(): this {
    this.steps.push({ kind: 'analyze' });
    return this;
  }

  advance(ms: number): this {
    this.steps.push({ kind: 'advance', ms });
    return this;
  }

  sweep(): this {
    this.steps.push({ kind: 'sweep' });
    return this;
  }

  plan(): ScenarioPlan {
    return { setup: [...this.setupEffects], steps: [...this.steps], sessions: [...this.sessions] };
  }
}

export type ToolOptions = {
  /** Real file changes the call makes, applied between PreToolUse and PostToolUse. */
  effects?: FileEffect[];
  /** Set when a subagent makes the call. */
  agent?: SubagentRef;
  /** Steps that happen while the call runs (for example a subagent's own work). */
  during?: () => void;
};

/**
 * One simulated Claude Code session. Every method sends the hook payloads a
 * real session would send and then imports the spool, so ordering and
 * snapshots follow the real collector.
 */
export class ClaudeSession {
  private promptId: string | null = null;
  private lastPromptId: string | null = null;

  private readonly script: Script;
  readonly key: string;
  readonly id: string;
  private readonly options: { cwd: string; permissionMode: string };

  constructor(
    script: Script,
    key: string,
    id: string,
    options: { cwd: string; permissionMode: string },
  ) {
    this.script = script;
    this.key = key;
    this.id = id;
    this.options = options;
  }

  get cwd(): string {
    return this.options.cwd;
  }

  private base(): { session_id: string; transcript_path: string; cwd: string } {
    return {
      session_id: this.id,
      transcript_path: transcriptPath(this.script.world.home, this.options.cwd, this.id),
      cwd: this.options.cwd,
    };
  }

  private turn(): { prompt_id: string; permission_mode: string } {
    if (this.promptId === null) throw new Error('tool call or stop before any prompt');
    return { prompt_id: this.promptId, permission_mode: this.options.permissionMode };
  }

  instructionsLoaded(filePath: string, memoryType = 'Project', loadReason = 'session_start'): this {
    this.script.hook({
      ...this.base(),
      hook_event_name: 'InstructionsLoaded',
      file_path: filePath,
      memory_type: memoryType,
      load_reason: loadReason,
    });
    this.script.import();
    return this;
  }

  start(source = 'startup'): this {
    this.script.hook({ ...this.base(), hook_event_name: 'SessionStart', source });
    this.script.import();
    return this;
  }

  prompt(text: string): this {
    this.promptId = randomUUID();
    this.lastPromptId = this.promptId;
    this.script.hook({
      ...this.base(),
      prompt_id: this.promptId,
      permission_mode: this.options.permissionMode,
      hook_event_name: 'UserPromptSubmit',
      prompt: text,
    });
    this.script.import();
    return this;
  }

  tool(call: ToolCall, options: ToolOptions = {}): this {
    const toolUseId = newToolUseId();
    const agent: JsonObject =
      options.agent === undefined
        ? {}
        : { agent_id: options.agent.id, agent_type: options.agent.type };
    const effort = { level: options.agent === undefined ? 'medium' : 'low' };
    const common = { ...this.base(), ...this.turn(), ...agent, effort };
    this.script.hook({
      ...common,
      hook_event_name: 'PreToolUse',
      tool_name: call.name,
      tool_input: call.input,
      tool_use_id: toolUseId,
    });
    options.during?.();
    this.script.effect(...(options.effects ?? []));
    this.script.hook({
      ...common,
      hook_event_name: 'PostToolUse',
      tool_name: call.name,
      tool_input: call.input,
      tool_response: call.response,
      tool_use_id: toolUseId,
      duration_ms: call.durationMs,
    });
    this.script.hook({
      ...common,
      hook_event_name: 'PostToolBatch',
      tool_calls: [
        {
          tool_name: call.name,
          tool_input: call.input,
          tool_use_id: toolUseId,
          tool_response: call.batchText,
        },
      ],
    });
    this.script.import();
    return this;
  }

  subagentStart(agent: SubagentRef): this {
    this.script.hook({
      ...this.base(),
      prompt_id: this.turn().prompt_id,
      agent_id: agent.id,
      agent_type: agent.type,
      hook_event_name: 'SubagentStart',
    });
    return this;
  }

  subagentStop(agent: SubagentRef, message: string): this {
    this.script.hook({
      ...this.base(),
      ...this.turn(),
      agent_id: agent.id,
      agent_type: agent.type,
      effort: { level: 'low' },
      hook_event_name: 'SubagentStop',
      stop_hook_active: false,
      agent_transcript_path: `${this.script.world.home}/.claude/projects/${projectSlug(this.options.cwd)}/${this.id}/subagents/agent-${agent.id}.jsonl`,
      last_assistant_message: message,
      background_tasks: [],
    });
    return this;
  }

  stop(message: string, options: { backgroundTasks?: JsonObject[] } = {}): this {
    this.script.hook({
      ...this.base(),
      ...this.turn(),
      effort: { level: 'medium' },
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: message,
      background_tasks: options.backgroundTasks ?? [],
      session_crons: [],
    });
    this.promptId = null;
    this.script.import();
    return this;
  }

  end(reason = 'prompt_input_exit'): this {
    const prompt: JsonObject = this.lastPromptId === null ? {} : { prompt_id: this.lastPromptId };
    this.script.hook({ ...this.base(), ...prompt, hook_event_name: 'SessionEnd', reason });
    this.script.import();
    return this;
  }
}

/**
 * Builds realistic, deterministic event timelines for the mock API.
 * Dev and test only: never imported by production code.
 */
import {
  emptyFacts,
  type EventFacts,
  type EventPayload,
  type EventView,
  type JsonObject,
  type JsonValue,
  type PromptOrigin,
  type Redaction,
  type ToolCall,
  type ToolCategory,
} from '@stillwatch/schema';

/** Deterministic fake sha256-looking hex. */
export function fakeHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  let out = '';
  for (let i = 0; out.length < 64; i++) {
    out += (Math.imul(h1 + i, 2654435761) ^ h2).toString(16).padStart(8, '0').slice(-8);
    h1 = Math.imul(h1 ^ h2, 3266489917) >>> 0;
  }
  return out.slice(0, 64);
}

type ToolOptions = {
  input?: JsonObject;
  response?: JsonValue;
  filePath?: string | null;
  url?: string | null;
  command?: string | null;
  facts?: Partial<EventFacts>;
  findingIds?: string[];
  durationMs?: number;
  outcome?: 'ok' | 'fail' | 'deny' | 'pending';
  error?: string;
  runInBackground?: boolean;
  sandboxDisabled?: boolean;
  mcpServer?: string;
};

const REDACTION_RE = /\[REDACTED:([a-z0-9-]{1,40}):([0-9a-f]{8})\]/g;

function redactionsIn(value: JsonValue, pointer: string, out: Redaction[]): void {
  if (typeof value === 'string') {
    const counts = new Map<string, Redaction>();
    for (const m of value.matchAll(REDACTION_RE)) {
      const detector = m[1] ?? '';
      const fingerprint = m[2] ?? '';
      const key = `${detector}:${fingerprint}`;
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { pointer, detector, fingerprint, count: 1 });
    }
    out.push(...counts.values());
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => redactionsIn(item, `${pointer}/${i}`, out));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      redactionsIn(v, `${pointer}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`, out);
    }
  }
}

export class TimelineBuilder {
  readonly events: EventView[] = [];
  private t: number;
  private n = 0;
  private callN = 0;
  private promptId: string | null = null;
  private agentId: string | null = null;
  private agentType: string | null = null;
  private prevHash = '';

  private readonly sessionId: string;
  private readonly idPrefix: string;
  private readonly cwd: string;
  private readonly seqBase: number;

  constructor(sessionId: string, idPrefix: string, cwd: string, startTs: number, seqBase: number) {
    this.sessionId = sessionId;
    this.idPrefix = idPrefix;
    this.cwd = cwd;
    this.seqBase = seqBase;
    this.t = startTs;
  }

  get now(): number {
    return this.t;
  }

  wait(ms: number): this {
    this.t += ms;
    return this;
  }

  private push(
    payload: EventPayload,
    sourceEvent: string,
    summary: string,
    extra: {
      tool?: ToolCall | null;
      facts?: Partial<EventFacts>;
      findingIds?: string[];
      gapMs?: number;
    } = {},
  ): EventView {
    this.t += extra.gapMs ?? 400 + ((this.n * 7919) % 2600);
    this.n++;
    const id = `${this.idPrefix}${String(this.n).padStart(4, '0')}`;
    const facts: EventFacts = { ...emptyFacts(1), ...extra.facts };
    const tool = extra.tool ?? null;
    const redactions: Redaction[] = [];
    redactionsIn(payload.data, '/data', redactions);
    if (tool) {
      redactionsIn(tool.input, '/tool/input', redactions);
      if (tool.response !== null) redactionsIn(tool.response, '/tool/response', redactions);
      if (tool.error !== null) redactionsIn(tool.error, '/tool/error', redactions);
    }
    if (facts.secrets.length === 0 && redactions.length > 0) {
      facts.secrets = redactions.map((r) => ({
        detector: r.detector,
        fingerprint: r.fingerprint,
        where: r.pointer.startsWith('/tool/response') ? 'tool.response' : 'tool.input',
      }));
    }
    const hash = fakeHash(`${this.prevHash}\n${id}`);
    this.prevHash = hash;
    const event = {
      id,
      sourceId: `spool-${id}`,
      agent: 'claude-code',
      sessionId: this.sessionId,
      agentId: this.agentId,
      agentType: this.agentType,
      promptId: this.promptId,
      sourceEvent,
      ts: this.t,
      cwd: this.cwd,
      permissionMode: 'default',
      transcriptPath: `/Users/dev/.claude/projects/${this.sessionId}.jsonl`,
      tool,
      ...payload,
      seq: this.seqBase + this.n,
      orderTs: this.t,
      facts,
      redactions,
      hash,
      summary,
      findingIds: extra.findingIds ?? [],
    } as EventView;
    this.events.push(event);
    return event;
  }

  /** Runs `body` as a subagent: events carry its id and type. */
  subagent(type: string, body: (b: this) => void): string {
    const id = `agent-${this.idPrefix}${this.n}`;
    this.push(
      { kind: 'subagent.start', data: { subagentId: id, subagentType: type } },
      'SubagentStart',
      `Started subagent ${type}`,
    );
    const saved = [this.agentId, this.agentType] as const;
    this.agentId = id;
    this.agentType = type;
    body(this);
    [this.agentId, this.agentType] = saved;
    this.push(
      {
        kind: 'subagent.stop',
        data: {
          subagentId: id,
          subagentType: type,
          transcriptPath: `/Users/dev/.claude/projects/${this.sessionId}/${id}.jsonl`,
          lastMessage: `The ${type} subagent finished its search and reported back.`,
        },
      },
      'SubagentStop',
      `Subagent ${type} finished`,
    );
    return id;
  }

  sessionStart(model: string, source = 'startup'): this {
    this.push(
      { kind: 'session.start', data: { source, model, sessionTitle: null } },
      'SessionStart',
      `Session started (${source})`,
      { gapMs: 50 },
    );
    return this;
  }

  sessionEnd(reason: string): this {
    this.push({ kind: 'session.end', data: { reason } }, 'SessionEnd', `Session ended (${reason})`);
    return this;
  }

  prompt(text: string, origin: PromptOrigin = 'user', findingIds: string[] = []): this {
    this.promptId = `prompt-${this.idPrefix}${this.n}`;
    const label =
      origin === 'user'
        ? 'Prompt'
        : origin === 'task_notification'
          ? 'Background task reported back'
          : 'System prompt';
    const firstLine = text.split('\n')[0] ?? '';
    this.push(
      { kind: 'prompt.submit', data: { prompt: text, origin, sessionTitle: null } },
      'UserPromptSubmit',
      `${label}: ${firstLine.length > 90 ? `${firstLine.slice(0, 90)}...` : firstLine}`,
      { gapMs: 20_000, findingIds },
    );
    return this;
  }

  expand(commandName: string, args: string): this {
    this.push(
      {
        kind: 'prompt.expand',
        data: {
          expansionType: 'slash_command',
          commandName,
          commandArgs: args,
          commandSource: 'project',
          prompt: `Run the ${commandName} workflow with: ${args}`,
        },
      },
      'UserPromptExpansion',
      `Expanded /${commandName}`,
    );
    return this;
  }

  stop(lastMessage: string): this {
    this.push(
      {
        kind: 'turn.stop',
        data: { lastMessage, backgroundTasks: [], sessionCrons: [], stopHookActive: false },
      },
      'Stop',
      'Turn finished',
    );
    this.promptId = null;
    return this;
  }

  stopWithLeftovers(lastMessage: string, command: string, findingIds: string[]): this {
    this.push(
      {
        kind: 'turn.stop',
        data: {
          lastMessage,
          backgroundTasks: [
            {
              id: 'bg-1',
              type: 'shell',
              status: 'running',
              description: 'Dev server',
              command,
            },
          ],
          sessionCrons: [
            { id: 'cron-1', schedule: '*/30 * * * *', recurring: true, prompt: 'Check CI status' },
          ],
          stopHookActive: false,
        },
      },
      'Stop',
      'Turn finished with a background task still running',
      { findingIds },
    );
    this.promptId = null;
    return this;
  }

  turnFailure(error: string): this {
    this.push(
      {
        kind: 'turn.failure',
        data: { error, errorDetails: 'HTTP 529 from the model API', lastMessage: null },
      },
      'StopFailure',
      `Turn failed: ${error}`,
    );
    this.promptId = null;
    return this;
  }

  private tool(name: string, category: ToolCategory, summary: string, o: ToolOptions): EventView {
    this.callN++;
    const useId = `toolu_${this.idPrefix}${this.callN}`;
    const base: ToolCall = {
      name,
      useId,
      category,
      input: o.input ?? {},
      response: null,
      error: null,
      isInterrupt: null,
      durationMs: null,
      mcpServer: o.mcpServer ? { name: o.mcpServer, source: 'project' } : null,
      filePath: o.filePath ?? null,
      url: o.url ?? null,
      command: o.command ?? null,
      sandboxDisabled: o.sandboxDisabled ?? false,
      runInBackground: o.runInBackground ?? false,
      changedFiles: [],
    };
    const facts = o.facts ?? {};
    const findingIds = o.findingIds ?? [];
    const pre = this.push({ kind: 'tool.pre', data: {} }, 'PreToolUse', `${summary} (started)`, {
      tool: base,
      facts,
      findingIds,
    });
    const outcome = o.outcome ?? 'ok';
    if (outcome === 'pending') return pre;
    if (outcome === 'deny') {
      this.push(
        { kind: 'permission.request', data: { suggestions: [{ type: 'addRules', rules: [] }] } },
        'PermissionRequest',
        `Asked permission: ${summary}`,
        { tool: { ...base, useId: null } },
      );
      return this.push(
        { kind: 'permission.denied', data: { reason: 'The user declined this action.' } },
        'PermissionDenied',
        `Denied: ${summary}`,
        { tool: base, findingIds, gapMs: 6000 },
      );
    }
    const durationMs = o.durationMs ?? 120 + ((this.callN * 337) % 4000);
    if (outcome === 'fail') {
      return this.push(
        { kind: 'tool.failure', data: {} },
        'PostToolUseFailure',
        `Failed: ${summary}`,
        {
          tool: { ...base, error: o.error ?? 'Command failed', isInterrupt: false, durationMs },
          facts,
          findingIds,
          gapMs: durationMs,
        },
      );
    }
    return this.push({ kind: 'tool.post', data: {} }, 'PostToolUse', summary, {
      tool: { ...base, response: o.response ?? { ok: true }, durationMs },
      facts,
      findingIds,
      gapMs: durationMs,
    });
  }

  read(path: string, content = 'export {};\n', findingIds: string[] = []): EventView {
    return this.tool('Read', 'file.read', `Read ${this.rel(path)}`, {
      input: { file_path: path },
      response: { type: 'text', file: { filePath: path, content, numLines: 42 } },
      filePath: path,
      facts: { files: [{ path, op: 'read', via: 'tool', detail: 'Read tool', unresolved: false }] },
      findingIds,
    });
  }

  search(pattern: string, tool: 'Grep' | 'Glob' = 'Grep'): EventView {
    return this.tool(tool, 'file.search', `Searched for ${pattern}`, {
      input: { pattern, path: this.cwd },
      response: { numFiles: 4, filenames: ['src/auth/session.ts', 'src/auth/login.ts'] },
    });
  }

  write(path: string, content: string, findingIds: string[] = []): EventView {
    return this.tool('Write', 'file.write', `Wrote ${this.rel(path)}`, {
      input: { file_path: path, content },
      response: { type: 'create', filePath: path },
      filePath: path,
      facts: {
        files: [{ path, op: 'write', via: 'tool', detail: 'Write tool', unresolved: false }],
      },
      findingIds,
    });
  }

  edit(path: string, oldText: string, newText: string, findingIds: string[] = []): EventView {
    return this.tool('Edit', 'file.edit', `Edited ${this.rel(path)}`, {
      input: { file_path: path, old_string: oldText, new_string: newText },
      response: { filePath: path, structuredPatch: [{ oldStart: 12, newStart: 12, lines: 4 }] },
      filePath: path,
      facts: {
        files: [{ path, op: 'write', via: 'tool', detail: 'Edit tool', unresolved: false }],
      },
      findingIds,
    });
  }

  bash(
    command: string,
    stdout: string,
    o: Omit<ToolOptions, 'input' | 'command'> & { description?: string } = {},
  ): EventView {
    const program = command.split(' ')[0] ?? command;
    const short = command.length > 80 ? `${command.slice(0, 80)}...` : command;
    return this.tool('Bash', 'shell', `Ran ${short}`, {
      ...o,
      input: {
        command,
        description: o.description ?? 'Run command',
        ...(o.runInBackground ? { run_in_background: true } : {}),
      },
      response: o.response ?? { stdout, stderr: '', interrupted: false },
      command,
      facts: {
        commands: [
          {
            program,
            args: command.split(' ').slice(1),
            text: command.slice(0, 500),
            sudo: false,
            pipedToShell: false,
            background: o.runInBackground ?? false,
            depth: 0,
          },
        ],
        ...o.facts,
      },
    });
  }

  webFetch(url: string, findingIds: string[] = []): EventView {
    const domain = new URL(url.replace(/\[[^\]]*\]/g, 'x')).hostname;
    return this.tool('WebFetch', 'web.fetch', `Fetched ${url}`, {
      input: { url, prompt: 'Summarize the API reference for session expiry' },
      response: { code: 200, result: 'The session endpoint accepts a ttl field in seconds.' },
      url,
      facts: {
        urls: [url],
        domains: [domain],
        signals: [{ kind: 'network', detail: domain, source: 'tool.input', confidence: 'high' }],
      },
      findingIds,
    });
  }

  webSearch(query: string): EventView {
    return this.tool('WebSearch', 'web.search', `Searched the web for ${query}`, {
      input: { query },
      response: { results: [{ title: 'Session cookies', url: 'https://developer.mozilla.org' }] },
    });
  }

  mcp(name: string, server: string, input: JsonObject): EventView {
    return this.tool(name, 'mcp', `Called ${name}`, {
      input,
      mcpServer: server,
      response: { content: [{ type: 'text', text: 'Issue #482 created' }] },
    });
  }

  agentCall(type: string, description: string, body: (b: this) => void): string {
    this.callN++;
    const useId = `toolu_${this.idPrefix}agent${this.callN}`;
    const tool: ToolCall = {
      name: 'Agent',
      useId,
      category: 'agent',
      input: { subagent_type: type, description, prompt: description },
      response: null,
      error: null,
      isInterrupt: null,
      durationMs: null,
      mcpServer: null,
      filePath: null,
      url: null,
      command: null,
      sandboxDisabled: false,
      runInBackground: false,
      changedFiles: [],
    };
    this.push(
      { kind: 'tool.pre', data: {} },
      'PreToolUse',
      `Delegated to ${type}: ${description}`,
      {
        tool,
      },
    );
    const started = this.t;
    const id = this.subagent(type, body);
    this.push({ kind: 'tool.post', data: {} }, 'PostToolUse', `${type} subagent returned`, {
      tool: {
        ...tool,
        response: { status: 'completed', content: 'Found 3 places that set the timeout.' },
        durationMs: this.t - started,
      },
    });
    return id;
  }

  batch(names: string[]): this {
    this.push(
      {
        kind: 'tool.batch',
        data: {
          calls: names.map((toolName, i) => ({
            toolUseId: `toolu_batch_${this.n}_${i}`,
            toolName,
            resultPreview: `${toolName} ok`,
          })),
        },
      },
      'PostToolBatch',
      `Finished ${names.length} parallel tool calls`,
      { gapMs: 30 },
    );
    return this;
  }

  task(kind: 'task.created' | 'task.completed', subject: string): this {
    this.push(
      {
        kind,
        data: { taskId: `task-${subject.length}`, subject, description: null, teammateName: null },
      },
      kind === 'task.created' ? 'TaskCreated' : 'TaskCompleted',
      `${kind === 'task.created' ? 'Created task' : 'Completed task'}: ${subject}`,
    );
    return this;
  }

  instructions(filePath: string, memoryType: string, findingIds: string[] = []): this {
    this.push(
      {
        kind: 'instructions.loaded',
        data: {
          filePath,
          memoryType,
          loadReason: 'session_start',
          globs: [],
          triggerFilePath: null,
          parentFilePath: null,
        },
      },
      'InstructionsLoaded',
      `Loaded instructions from ${this.rel(filePath)}`,
      { gapMs: 30, findingIds },
    );
    return this;
  }

  configChange(filePath: string): this {
    this.push(
      { kind: 'config.change', data: { source: 'project_settings', filePath } },
      'ConfigChange',
      `Settings changed: ${this.rel(filePath)}`,
    );
    return this;
  }

  cwdChange(oldCwd: string, newCwd: string): this {
    this.push(
      { kind: 'cwd.change', data: { oldCwd, newCwd } },
      'CwdChanged',
      `Changed directory to ${newCwd}`,
    );
    return this;
  }

  directoryAdd(directory: string): this {
    this.push(
      { kind: 'directory.add', data: { directory, source: 'slash_command' } },
      'AddDir',
      `Added directory ${directory}`,
    );
    return this;
  }

  fileChange(filePath: string, change: string): this {
    this.push(
      { kind: 'file.change', data: { filePath, change } },
      'FileChanged',
      `File ${change}: ${this.rel(filePath)}`,
    );
    return this;
  }

  compact(): this {
    this.push(
      { kind: 'compact.pre', data: { trigger: 'auto', customInstructions: null } },
      'PreCompact',
      'Conversation compaction started',
    );
    this.push(
      {
        kind: 'compact.post',
        data: {
          trigger: 'auto',
          summary: 'Fixed the timeout constant; tests pass; deploy notes still pending.',
        },
      },
      'PostCompact',
      'Conversation compacted',
    );
    return this;
  }

  modelSwitch(fromModel: string, toModel: string): this {
    this.push(
      { kind: 'model.switch', data: { fromModel, toModel, source: 'user' } },
      'ModelSwitch',
      `Model changed to ${toModel}`,
    );
    return this;
  }

  notification(message: string): this {
    this.push(
      {
        kind: 'notification',
        data: { notificationType: 'permission_prompt', title: 'Claude Code', message },
      },
      'Notification',
      `Notification: ${message}`,
    );
    return this;
  }

  unknown(sourceEvent: string, raw: JsonObject): this {
    this.push({ kind: 'unknown', data: { raw } }, sourceEvent, `Unrecognized event ${sourceEvent}`);
    return this;
  }

  /** Typical low-key work: reads, searches, an edit, and a test run. */
  routine(files: string[], rounds: number): this {
    for (let r = 0; r < rounds; r++) {
      const a = files[r % files.length] ?? 'README.md';
      const b = files[(r + 1) % files.length] ?? 'README.md';
      this.search(`function ${['parse', 'load', 'render', 'save'][r % 4] ?? 'x'}`);
      this.read(`${this.cwd}/${a}`);
      this.read(`${this.cwd}/${b}`);
      this.batch(['Read', 'Read']);
      if (r % 2 === 0) this.edit(`${this.cwd}/${a}`, 'const retries = 1;', 'const retries = 3;');
      this.bash('pnpm test --run', ` Test Files  12 passed (12)\n      Tests  148 passed (148)`);
    }
    return this;
  }

  rel(path: string): string {
    return path.startsWith(`${this.cwd}/`) ? path.slice(this.cwd.length + 1) : path;
  }
}

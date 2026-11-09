import { describe, expect, it } from 'vitest';
import { LIMITS, isKind } from '@stillwatch/schema';
import { adaptClaudeRecord } from '../src/index';
import { adaptOk, BASE, record } from './helpers';

describe('synthetic events', () => {
  it('maps session start and end', () => {
    const start = adaptOk({
      hook_event_name: 'SessionStart',
      source: 'resume',
      model: 'claude-opus-5',
      session_title: 'Fix login',
    });
    expect(start.kind).toBe('session.start');
    if (isKind(start, 'session.start')) {
      expect(start.data).toEqual({
        source: 'resume',
        model: 'claude-opus-5',
        sessionTitle: 'Fix login',
      });
    }
    expect(start.tool).toBeNull();
    const end = adaptOk({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
    if (isKind(end, 'session.end')) expect(end.data.reason).toBe('prompt_input_exit');
  });

  it('copies base fields', () => {
    const e = adaptOk({
      hook_event_name: 'SessionEnd',
      prompt_id: 'p-1',
      agent_id: 'ag-1',
      agent_type: 'Plan',
    });
    expect(e).toMatchObject({
      agent: 'claude-code',
      sessionId: 'sess-1',
      promptId: 'p-1',
      agentId: 'ag-1',
      agentType: 'Plan',
      cwd: BASE.cwd,
      permissionMode: 'default',
      transcriptPath: BASE.transcript_path,
      sourceEvent: 'SessionEnd',
    });
  });

  it('uses the injected id generator and receive time', () => {
    const result = adaptClaudeRecord(
      record({ ...BASE, hook_event_name: 'Stop' }, { receivedAt: 1234.5 }),
      {
        newId: (ts) => `id-${ts}`,
      },
    );
    expect(result.ok && result.event.id).toBe('id-1234.5');
    expect(result.ok && result.event.ts).toBe(1234.5);
  });

  it('maps prompt expansion', () => {
    const e = adaptOk({
      hook_event_name: 'UserPromptExpansion',
      expansion_type: 'slash_command',
      command_name: 'deploy',
      command_args: 'staging',
      command_source: 'plugin',
      prompt: '/deploy staging',
    });
    expect(e.kind).toBe('prompt.expand');
    if (isKind(e, 'prompt.expand')) expect(e.data.commandName).toBe('deploy');
  });

  it('maps tool failure', () => {
    const e = adaptOk({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_use_id: 'toolu_1',
      error: 'Exit code 1\nboom',
      is_interrupt: false,
      duration_ms: 4187,
    });
    expect(e.kind).toBe('tool.failure');
    expect(e.tool).toMatchObject({
      error: 'Exit code 1\nboom',
      isInterrupt: false,
      durationMs: 4187,
      response: null,
    });
  });

  it('maps permission denied with an MCP server', () => {
    const e = adaptOk({
      hook_event_name: 'PermissionDenied',
      tool_name: 'mcp__github__create_issue',
      tool_input: { title: 'x' },
      tool_use_id: 'toolu_2',
      reason: '[Data Exfiltration]',
      mcp_server: { name: 'github', source: 'user' },
    });
    expect(e.kind).toBe('permission.denied');
    if (isKind(e, 'permission.denied')) expect(e.data.reason).toBe('[Data Exfiltration]');
    expect(e.tool).toMatchObject({
      category: 'mcp',
      useId: 'toolu_2',
      mcpServer: { name: 'github', source: 'user' },
    });
  });

  it('derives the MCP server from the tool name when mcp_server is absent', () => {
    const e = adaptOk({
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__memory__create_entities',
      tool_input: {},
    });
    expect(e.tool?.mcpServer).toEqual({ name: 'memory', source: null });
  });

  it('maps notification, tasks, stop failure, config, directories, files, compaction, model switch', () => {
    const n = adaptOk({
      hook_event_name: 'Notification',
      message: 'Claude needs your permission',
      title: 'Permission',
      notification_type: 'permission_prompt',
    });
    if (isKind(n, 'notification')) expect(n.data.notificationType).toBe('permission_prompt');
    for (const [name, kind] of [
      ['TaskCreated', 'task.created'],
      ['TaskCompleted', 'task.completed'],
    ] as const) {
      const t = adaptOk({
        hook_event_name: name,
        task_id: 'task-1',
        task_subject: 'Auth',
        task_description: 'Add login',
        teammate_name: 'impl',
      });
      expect(t.kind).toBe(kind);
      expect(t.data).toEqual({
        taskId: 'task-1',
        subject: 'Auth',
        description: 'Add login',
        teammateName: 'impl',
      });
    }
    const sf = adaptOk({
      hook_event_name: 'StopFailure',
      error: 'rate_limit',
      error_details: { status: 429 },
      last_assistant_message: 'API Error',
    });
    if (isKind(sf, 'turn.failure'))
      expect(sf.data).toEqual({
        error: 'rate_limit',
        errorDetails: '{"status":429}',
        lastMessage: 'API Error',
      });
    const cc = adaptOk({
      hook_event_name: 'ConfigChange',
      source: 'project_settings',
      file_path: '/p/.claude/settings.json',
    });
    expect(cc.data).toEqual({ source: 'project_settings', filePath: '/p/.claude/settings.json' });
    const da = adaptOk({
      hook_event_name: 'DirectoryAdded',
      directory: '/other',
      source: 'slash_command',
    });
    expect(da.data).toEqual({ directory: '/other', source: 'slash_command' });
    const fc = adaptOk({ hook_event_name: 'FileChanged', file_path: '/p/.envrc', event: 'change' });
    expect(fc.data).toEqual({ filePath: '/p/.envrc', change: 'change' });
    const pre = adaptOk({
      hook_event_name: 'PreCompact',
      trigger: 'manual',
      custom_instructions: null,
    });
    expect(pre.data).toEqual({ trigger: 'manual', customInstructions: null });
    const post = adaptOk({
      hook_event_name: 'PostCompact',
      trigger: 'auto',
      compact_summary: 'summary',
    });
    expect(post.data).toEqual({ trigger: 'auto', summary: 'summary' });
    for (const name of ['PostModelSwitch', 'PreModelSwitch']) {
      const m = adaptOk({ hook_event_name: name, from_model: 'a', to_model: 'b', source: 'auto' });
      expect(m.kind).toBe('model.switch');
      expect(m.data).toEqual({ fromModel: 'a', toModel: 'b', source: 'auto' });
    }
  });

  it('maps stop with session crons', () => {
    const e = adaptOk({
      hook_event_name: 'Stop',
      last_assistant_message: 'done',
      stop_hook_active: true,
      background_tasks: [
        { id: 't', type: 'shell', status: 'running', command: 'tail -f x' },
        'junk',
      ],
      session_crons: [{ id: 'c', schedule: '0 9 * * 1-5', recurring: true, prompt: 'check' }],
    });
    if (!isKind(e, 'turn.stop')) throw new Error('kind');
    expect(e.data.backgroundTasks).toEqual([
      { id: 't', type: 'shell', status: 'running', description: null, command: 'tail -f x' },
    ]);
    expect(e.data.sessionCrons).toEqual([
      { id: 'c', schedule: '0 9 * * 1-5', recurring: true, prompt: 'check' },
    ]);
  });

  it('reads bash edit diffs and sandbox flags', () => {
    const files = Array.from({ length: 250 }, (_, i) => `/p/f${i}.ts`);
    const e = adaptOk({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_3',
      tool_input: {
        command: 'sed -i s/a/b/ x',
        dangerouslyDisableSandbox: true,
        run_in_background: true,
      },
      tool_response: {
        stdout: '',
        stderr: '',
        interrupted: false,
        isImage: false,
        bashEditDiff: { changedFiles: [...files, 5], files: [{ hunks: [] }], moreFiles: 50 },
      },
    });
    expect(e.tool?.sandboxDisabled).toBe(true);
    expect(e.tool?.runInBackground).toBe(true);
    expect(e.tool?.changedFiles).toHaveLength(200);
    expect(JSON.stringify(e.tool?.response)).not.toContain('hunks');
    expect(e.tool?.response).toMatchObject({ bashEditDiff: { moreFiles: 50, unavailable: null } });
  });

  it('drops image output from bash results', () => {
    const e = adaptOk({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'cat x.png' },
      tool_response: { stdout: 'iVBOR', isImage: true },
    });
    expect(e.tool?.response).toMatchObject({ stdout: null, isImage: true });
  });

  it('keeps other tool responses but strips bulky fields', () => {
    const e = adaptOk({
      hook_event_name: 'PostToolUse',
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: '/p/a.ipynb' },
      tool_response: { ok: 1, originalFile: 'big', structuredPatch: [] },
    });
    expect(e.tool?.response).toEqual({ ok: 1 });
    expect(e.tool?.filePath).toBe('/p/a.ipynb');
    expect(e.tool?.category).toBe('notebook');
  });

  it('maps unknown events to raw data without common fields', () => {
    const e = adaptOk({
      hook_event_name: 'BrandNewEvent',
      agent_id: 'x',
      effort: { level: 'low' },
      foo: [1, 2],
    });
    expect(e.kind).toBe('unknown');
    expect(e.data).toEqual({ raw: { foo: [1, 2] } });
  });

  it('falls back to the event hint, then to Unknown', () => {
    const hinted = adaptClaudeRecord(record({ ...BASE }, { eventHint: 'Stop' }));
    expect(hinted.ok && hinted.event.kind).toBe('turn.stop');
    const bad = adaptClaudeRecord(
      record({ ...BASE, hook_event_name: 'not an event name!' }, { eventHint: '../evil' }),
    );
    expect(bad.ok && bad.event.sourceEvent).toBe('Unknown');
    expect(bad.ok && bad.event.kind).toBe('unknown');
  });

  it('treats wrongly typed fields as absent', () => {
    const e = adaptOk({
      hook_event_name: 'PreToolUse',
      tool_name: 42,
      tool_input: 'not an object',
      tool_use_id: ['x'],
      cwd: 7,
      prompt_id: 'bad\u0000id',
    });
    expect(e.tool).toMatchObject({ name: 'Unknown', category: 'other', input: {}, useId: null });
    expect(e.cwd).toBeNull();
    expect(e.promptId).toBeNull();
    const p = adaptOk({ hook_event_name: 'UserPromptSubmit', prompt: { text: 'x' } });
    if (isKind(p, 'prompt.submit'))
      expect(p.data).toEqual({ prompt: '', origin: 'user', sessionTitle: null });
  });
});

describe('malformed and adversarial records', () => {
  const failures: [string, unknown][] = [
    ['not JSON', '{"session_id": "abc", '],
    ['array', '[1,2,3]'],
    ['string', '"hello"'],
    ['null', 'null'],
    ['empty', ''],
    ['no session', { hook_event_name: 'Stop' }],
    ['numeric session', { session_id: 12, hook_event_name: 'Stop' }],
    ['empty session', { session_id: '', hook_event_name: 'Stop' }],
    ['long session', { session_id: 'x'.repeat(257), hook_event_name: 'Stop' }],
    ['control session', { session_id: 'a\nb', hook_event_name: 'Stop' }],
  ];
  for (const [label, body] of failures) {
    it(`rejects ${label} without throwing`, () => {
      const result = adaptClaudeRecord(record(body));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    });
  }

  it('salvages the session id from broken JSON', () => {
    const result = adaptClaudeRecord(record('{"session_id": "sess-9", "hook_event_name": "Pre'));
    expect(result).toEqual({ ok: false, reason: 'payload is not valid JSON', sessionId: 'sess-9' });
  });

  it('rejects oversized records and still salvages', () => {
    const body = `{"session_id":"sess-big","x":"${'a'.repeat(LIMITS.maxRecordBytes)}"}`;
    const result = adaptClaudeRecord(record(body));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.sessionId).toBe('sess-big');
  });

  it('rejects a non-finite receive time', () => {
    expect(
      adaptClaudeRecord(record({ ...BASE, hook_event_name: 'Stop' }, { receivedAt: Number.NaN }))
        .ok,
    ).toBe(false);
  });

  it('caps deep nesting instead of overflowing', () => {
    const deep = `{"session_id":"s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":${'['.repeat(10_000)}${']'.repeat(10_000)}}`;
    const result = adaptClaudeRecord(record(deep));
    expect(result.ok).toBe(true);
    const veryDeep = `{"session_id":"s","x":${'['.repeat(500_000)}${']'.repeat(500_000)}}`;
    expect(() => adaptClaudeRecord(record(veryDeep))).not.toThrow();
  });

  it('keeps huge strings intact for later redaction and truncation', () => {
    const e = adaptOk({ hook_event_name: 'UserPromptSubmit', prompt: 'p'.repeat(2_000_000) });
    if (isKind(e, 'prompt.submit')) expect(e.data.prompt).toHaveLength(2_000_000);
  });

  it('never throws on random shapes', () => {
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const values = (): unknown => {
      const r = rand();
      if (r < 0.2) return null;
      if (r < 0.4) return Math.floor(rand() * 1000);
      if (r < 0.6) return 'v'.repeat(Math.floor(rand() * 20));
      if (r < 0.8) return [values(), values()];
      return { tool_response: values(), file: values(), bashEditDiff: values() };
    };
    const events = [
      'PreToolUse',
      'PostToolUse',
      'PostToolBatch',
      'Stop',
      'StopFailure',
      'SubagentStop',
      'InstructionsLoaded',
      'Nope',
    ];
    const keys = [
      'tool_name',
      'tool_input',
      'tool_response',
      'tool_calls',
      'background_tasks',
      'session_crons',
      'globs',
      'error',
      'mcp_server',
      'agent_id',
      'prompt',
    ];
    for (let i = 0; i < 2000; i++) {
      const payload: Record<string, unknown> = {
        session_id: 's',
        hook_event_name: events[i % events.length],
      };
      for (const key of keys)
        if (rand() < 0.6) payload[key] = key === 'tool_name' && rand() < 0.5 ? 'Read' : values();
      expect(() => adaptClaudeRecord(record(payload))).not.toThrow();
    }
  });
});

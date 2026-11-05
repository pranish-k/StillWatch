import { describe, expect, it } from 'vitest';
import { EVENT_KINDS } from '@stillwatch/schema';
import type { EventKind, NormalizedEvent, ToolCall } from '@stillwatch/schema';
import { describeEvent } from '../src/index';
import { HOME, ROOT } from './fixtures';

function tool(over: Partial<ToolCall> & Pick<ToolCall, 'name' | 'category'>): ToolCall {
  return {
    useId: 't1',
    input: {},
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
    ...over,
  };
}

const base = {
  id: 'e1',
  sourceId: 's1',
  agent: 'claude-code' as const,
  sessionId: 'sess',
  agentId: null,
  agentType: null,
  promptId: null,
  sourceEvent: 'X',
  ts: 0,
  cwd: ROOT,
  permissionMode: null,
  transcriptPath: null,
  tool: null,
};

/** One representative event per kind. */
function sample(kind: EventKind): NormalizedEvent {
  const bash = tool({ name: 'Bash', category: 'shell', command: 'git status --short' });
  switch (kind) {
    case 'session.start':
      return { ...base, kind, data: { source: 'startup', model: null, sessionTitle: null } };
    case 'session.end':
      return { ...base, kind, data: { reason: 'other' } };
    case 'prompt.submit':
      return {
        ...base,
        kind,
        data: { prompt: 'Fix the login timeout', origin: 'user', sessionTitle: null },
      };
    case 'prompt.expand':
      return {
        ...base,
        kind,
        data: {
          expansionType: 'slash_command',
          commandName: 'deploy',
          commandArgs: 'staging',
          commandSource: null,
          prompt: null,
        },
      };
    case 'tool.pre':
    case 'tool.post':
    case 'tool.failure':
      return { ...base, kind, tool: bash, data: {} };
    case 'tool.batch':
      return {
        ...base,
        kind,
        data: { calls: [{ toolUseId: 't1', toolName: 'Read', resultPreview: null }] },
      };
    case 'permission.request':
      return { ...base, kind, tool: { ...bash, useId: null }, data: { suggestions: null } };
    case 'permission.denied':
      return { ...base, kind, tool: bash, data: { reason: '[Data Exfiltration]' } };
    case 'subagent.start':
      return { ...base, kind, data: { subagentId: 'a1', subagentType: 'Explore' } };
    case 'subagent.stop':
      return {
        ...base,
        kind,
        data: {
          subagentId: 'a1',
          subagentType: 'Explore',
          transcriptPath: null,
          lastMessage: null,
        },
      };
    case 'task.created':
    case 'task.completed':
      return {
        ...base,
        kind,
        data: { taskId: 'k', subject: 'Write notes', description: null, teammateName: null },
      };
    case 'turn.stop':
      return {
        ...base,
        kind,
        data: { lastMessage: null, backgroundTasks: [], sessionCrons: [], stopHookActive: false },
      };
    case 'turn.failure':
      return {
        ...base,
        kind,
        data: { error: 'rate_limit', errorDetails: null, lastMessage: null },
      };
    case 'instructions.loaded':
      return {
        ...base,
        kind,
        data: {
          filePath: `${ROOT}/CLAUDE.md`,
          memoryType: 'Project',
          loadReason: 'session_start',
          globs: [],
          triggerFilePath: null,
          parentFilePath: null,
        },
      };
    case 'config.change':
      return { ...base, kind, data: { source: 'project_settings', filePath: null } };
    case 'cwd.change':
      return { ...base, kind, data: { oldCwd: ROOT, newCwd: `${ROOT}/src` } };
    case 'directory.add':
      return { ...base, kind, data: { directory: `${HOME}/other`, source: 'slash_command' } };
    case 'file.change':
      return { ...base, kind, data: { filePath: `${ROOT}/.envrc`, change: 'change' } };
    case 'compact.pre':
      return { ...base, kind, data: { trigger: 'auto', customInstructions: null } };
    case 'compact.post':
      return { ...base, kind, data: { trigger: 'manual', summary: null } };
    case 'model.switch':
      return { ...base, kind, data: { fromModel: null, toModel: 'claude-opus-5', source: null } };
    case 'notification':
      return {
        ...base,
        kind,
        data: { notificationType: 'idle_prompt', title: null, message: null },
      };
    case 'unknown':
      return { ...base, kind, sourceEvent: 'FutureEvent', data: { raw: {} } };
  }
}

const OPTIONS = { base: ROOT, home: HOME };

describe('describeEvent', () => {
  it('gives one short line for every event kind', () => {
    for (const kind of EVENT_KINDS) {
      const text = describeEvent(sample(kind), OPTIONS);
      expect(text.length).toBeGreaterThan(0);
      expect(text.length).toBeLessThanOrEqual(200);
      expect(text).not.toContain('\n');
      expect(text).not.toContain(String.fromCharCode(0x2014));
    }
  });

  it('matches the documented examples', () => {
    const d = (kind: EventKind) => describeEvent(sample(kind), OPTIONS);
    expect(d('tool.pre')).toBe('Ran git status --short');
    expect(d('tool.failure')).toBe('Failed to run git status --short');
    expect(d('prompt.submit')).toBe('Prompt: Fix the login timeout');
    expect(d('prompt.expand')).toBe('Ran /deploy staging');
    expect(d('session.start')).toBe('Session started (startup)');
    expect(d('session.end')).toBe('Session ended (other)');
    expect(d('turn.stop')).toBe('Turn finished');
    expect(d('turn.failure')).toBe('Turn failed: rate_limit');
    expect(d('subagent.start')).toBe('Started subagent Explore');
    expect(d('subagent.stop')).toBe('Subagent Explore finished');
    expect(d('instructions.loaded')).toBe('Loaded CLAUDE.md (project, session start)');
    expect(d('config.change')).toBe('Config changed: project settings');
    expect(d('permission.request')).toBe('Permission requested for Bash: git status --short');
    expect(d('permission.denied')).toBe('Auto mode denied Bash ([Data Exfiltration])');
    expect(d('cwd.change')).toBe('Changed directory to src');
    expect(d('directory.add')).toBe('Added directory ~/other');
    expect(d('notification')).toBe('Waiting for input');
    expect(d('unknown')).toBe('Unrecognized event FutureEvent');
  });

  it('describes each tool category', () => {
    const ev = (
      t: ToolCall,
      kind: 'tool.pre' | 'tool.post' | 'tool.failure' = 'tool.pre',
    ): string => describeEvent({ ...base, kind, tool: t, data: {} }, OPTIONS);
    expect(ev(tool({ name: 'Read', category: 'file.read', filePath: `${ROOT}/README.md` }))).toBe(
      'Read README.md',
    );
    expect(
      ev(
        tool({
          name: 'Read',
          category: 'file.read',
          filePath: `${ROOT}/README.md`,
          response: { numLines: 4 },
        }),
        'tool.post',
      ),
    ).toBe('Read README.md (4 lines)');
    expect(
      ev(
        tool({
          name: 'Write',
          category: 'file.write',
          filePath: `${ROOT}/notes/plan.md`,
          response: { type: 'create' },
        }),
        'tool.post',
      ),
    ).toBe('Wrote notes/plan.md (new file)');
    expect(ev(tool({ name: 'Edit', category: 'file.edit', filePath: `${ROOT}/src/auth.ts` }))).toBe(
      'Edited src/auth.ts',
    );
    expect(ev(tool({ name: 'Edit', category: 'file.edit', filePath: `${HOME}/.zshrc` }))).toBe(
      'Edited ~/.zshrc',
    );
    expect(
      ev(
        tool({
          name: 'WebFetch',
          category: 'web.fetch',
          url: 'https://user:pw@example.com/docs?q=1#x',
        }),
      ),
    ).toBe('Fetched example.com/docs');
    expect(
      ev(tool({ name: 'WebSearch', category: 'web.search', input: { query: 'react hooks' } })),
    ).toBe('Searched the web for react hooks');
    expect(ev(tool({ name: 'Glob', category: 'file.search', input: { pattern: '**/*.md' } }))).toBe(
      'Searched for files matching **/*.md',
    );
    expect(
      ev(
        tool({
          name: 'Agent',
          category: 'agent',
          input: { subagent_type: 'Explore', description: 'List files' },
        }),
      ),
    ).toBe('Delegated to subagent Explore: List files');
    expect(ev(tool({ name: 'mcp__github__create_issue', category: 'mcp' }))).toBe(
      'Called mcp__github__create_issue',
    );
    expect(ev(tool({ name: 'TodoWrite', category: 'task' }))).toBe('Updated the to-do list');
    expect(ev(tool({ name: 'ExitPlanMode', category: 'plan' }))).toBe('Presented a plan');
    expect(
      ev(
        tool({
          name: 'AskUserQuestion',
          category: 'question',
          input: { questions: [{ question: 'Which DB?' }] },
        }),
      ),
    ).toBe('Asked the user: Which DB?');
    expect(ev(tool({ name: 'Skill', category: 'other' }))).toBe('Used Skill');
    expect(
      ev(
        tool({
          name: 'Bash',
          category: 'shell',
          command: 'npm run dev',
          runInBackground: true,
          sandboxDisabled: true,
        }),
      ),
    ).toBe('Ran in the background and outside the sandbox: npm run dev');
    expect(
      ev(
        tool({
          name: 'Bash',
          category: 'shell',
          command: 'ls /x',
          error: 'Exit code 2\nls: /x: No such file',
        }),
        'tool.failure',
      ),
    ).toBe('Failed to run ls /x (exit code 2)');
    expect(
      ev(
        tool({
          name: 'Read',
          category: 'file.read',
          filePath: `${ROOT}/a`,
          error: 'File does not exist.',
        }),
        'tool.failure',
      ),
    ).toBe('Failed to read a (File does not exist.)');
  });

  it('collapses and caps long commands and prompts', () => {
    const long = `echo ${'x'.repeat(400)}\nrm -rf /`;
    const text = describeEvent({
      ...base,
      kind: 'tool.pre',
      tool: tool({ name: 'Bash', category: 'shell', command: long }),
      data: {},
    });
    expect(text).not.toContain('\n');
    expect(text.length).toBeLessThanOrEqual(4 + 160);
    expect(text.endsWith(String.fromCharCode(0x2026))).toBe(true);
    const prompt = describeEvent({
      ...base,
      kind: 'prompt.submit',
      data: { prompt: 'p'.repeat(500), origin: 'user', sessionTitle: null },
    });
    expect(prompt.length).toBeLessThanOrEqual('Prompt: '.length + 160);
    expect(
      describeEvent({
        ...base,
        kind: 'prompt.submit',
        data: { prompt: '<task-notification>', origin: 'task_notification', sessionTitle: null },
      }),
    ).toBe('Background task report');
  });
});

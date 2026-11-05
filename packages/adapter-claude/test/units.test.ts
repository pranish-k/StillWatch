import { describe, expect, it } from 'vitest';
import {
  CLAUDE_HOOK_EVENTS,
  NEVER_INSTALL_EVENTS,
  classifyClaudeTool,
  compareVersions,
  minimizeToolResponse,
  parseClaudeVersion,
  promptOrigin,
} from '../src/index';
import { boundedJson, sliceChars } from '../src/json';

describe('classifyClaudeTool', () => {
  it.each([
    ['Bash', 'shell'],
    ['PowerShell', 'shell'],
    ['KillShell', 'shell'],
    ['Read', 'file.read'],
    ['Write', 'file.write'],
    ['MultiEdit', 'file.edit'],
    ['NotebookEdit', 'notebook'],
    ['LS', 'file.search'],
    ['Grep', 'file.search'],
    ['WebFetch', 'web.fetch'],
    ['WebSearch', 'web.search'],
    ['Agent', 'agent'],
    ['Task', 'agent'],
    ['SubagentHandback', 'agent'],
    ['mcp__github__create_issue', 'mcp'],
    ['TodoWrite', 'task'],
    ['ScheduleWakeup', 'task'],
    ['ExitPlanMode', 'plan'],
    ['AskUserQuestion', 'question'],
    ['Skill', 'other'],
    ['bash', 'other'],
    ['', 'other'],
  ] as const)('%s is %s', (name, category) => {
    expect(classifyClaudeTool(name)).toBe(category);
  });
});

describe('promptOrigin', () => {
  it('recognizes known wrappers only', () => {
    expect(promptOrigin('  \n<task-notification>\n<task-id>x</task-id>')).toBe('task_notification');
    expect(promptOrigin('<cross-session-message from="a">hi')).toBe('cross_session');
    expect(promptOrigin('<scheduled-task id="1">')).toBe('scheduled');
    expect(promptOrigin('<scheduled_task>')).toBe('scheduled');
    expect(promptOrigin('<Task-Notification>')).toBe('user');
    expect(promptOrigin('<system>do x</system>')).toBe('user');
    expect(promptOrigin('please read <task-notification>')).toBe('user');
    expect(promptOrigin('')).toBe('user');
  });
});

describe('versions', () => {
  it('parses claude --version output', () => {
    expect(parseClaudeVersion('2.1.318 (Claude Code)')).toBe('2.1.318');
    expect(parseClaudeVersion('claude v2.2.0-beta.1\n')).toBe('2.2.0-beta.1');
    expect(parseClaudeVersion('no version here')).toBeNull();
    expect(parseClaudeVersion('9'.repeat(100_000))).toBeNull();
  });
  it('compares numerically with pre-releases first', () => {
    expect(compareVersions('2.1.318', '2.1.139')).toBeGreaterThan(0);
    expect(compareVersions('2.1.139', '2.1.139')).toBe(0);
    expect(compareVersions('2.1.9', '2.1.10')).toBeLessThan(0);
    expect(compareVersions('2.1', '2.1.0')).toBe(0);
    expect(compareVersions('v3.0.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.1.0-beta', '2.1.0')).toBeLessThan(0);
    expect(compareVersions('2.1.0-alpha.2', '2.1.0-alpha.10')).toBeLessThan(0);
    expect(compareVersions('2.1.0-alpha.1', '2.1.0-alpha.beta')).toBeLessThan(0);
    expect(compareVersions('2.1.0-alpha', '2.1.0-alpha.1')).toBeLessThan(0);
    expect(compareVersions('2.1.0+build', '2.1.0')).toBe(0);
  });
});

describe('hook spec', () => {
  it('is consistent', () => {
    const names = CLAUDE_HOOK_EVENTS.map((e) => e.event);
    expect(new Set(names).size).toBe(names.length);
    const never = new Set(NEVER_INSTALL_EVENTS.map((e) => e.event));
    for (const name of names) expect(never.has(name)).toBe(false);
    expect(CLAUDE_HOOK_EVENTS.find((e) => e.event === 'SessionEnd')).toMatchObject({
      mode: 'sync',
      timeoutSec: null,
    });
    expect(CLAUDE_HOOK_EVENTS.filter((e) => e.ensureCollector).map((e) => e.event)).toEqual([
      'SessionStart',
      'UserPromptSubmit',
    ]);
    for (const e of CLAUDE_HOOK_EVENTS) if (e.mode === 'async') expect(e.timeoutSec).toBeNull();
  });
});

describe('minimizeToolResponse', () => {
  it('handles Read results that are strings or images', () => {
    expect(minimizeToolResponse('Read', 'plain')).toMatchObject({
      content: 'plain',
      filePath: null,
    });
    expect(minimizeToolResponse('Read', { type: 'image', file: { base64: 'AAAA' } })).toMatchObject(
      { type: 'image', content: null },
    );
    expect(minimizeToolResponse('Read', undefined)).toBeNull();
  });
  it('minimizes ExitPlanMode and Agent', () => {
    expect(minimizeToolResponse('ExitPlanMode', { plan: '# p', filePath: '/x', flags: 1 })).toEqual(
      { plan: '# p', filePath: '/x' },
    );
    expect(
      minimizeToolResponse('Agent', {
        status: 'completed',
        content: [{ type: 'text', text: 'ok' }],
        usage: {},
      }),
    ).toMatchObject({
      status: 'completed',
      content: [{ type: 'text', text: 'ok' }],
    });
  });
});

describe('json helpers', () => {
  it('never splits surrogate pairs', () => {
    expect(sliceChars('ab\u{1F600}', 3)).toBe('ab');
    expect(sliceChars('abc', 10)).toBe('abc');
  });
  it('bounds serialization of huge values', () => {
    const big = Array.from({ length: 100_000 }, (_, i) => ({ i, s: 'x'.repeat(50) }));
    const started = performance.now();
    const out = boundedJson(big, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.startsWith('[{"i":0')).toBe(true);
    expect(performance.now() - started).toBeLessThan(50);
    expect(boundedJson({ a: [1, true, null] }, 200)).toBe('{"a":[1,true,null]}');
  });
});

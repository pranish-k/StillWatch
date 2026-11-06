import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  bashCall,
  editCall,
  fakeAwsAccessKeyId,
  newAgentId,
  newToolUseId,
  projectSlug,
  readCall,
  Script,
  structuredPatch,
  writeCall,
} from '../src/payloads';
import type { HookPayload, Step } from '../src/types';
import { FAKE_WORLD } from './helpers';

type FixtureRecord = { hookArg: string; payload: Record<string, unknown> };
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/claude-code/real-session-2.1.318.json', import.meta.url), 'utf8'),
) as { records: FixtureRecord[] };

function fixturePayload(
  predicate: (p: Record<string, unknown>) => boolean,
): Record<string, unknown> {
  const found = fixture.records.find((r) => predicate(r.payload));
  if (found === undefined) throw new Error('fixture record not found');
  return found.payload;
}

function keysOf(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>);
}

function hooks(steps: Step[]): HookPayload[] {
  return steps.flatMap((s) => (s.kind === 'hook' ? [s.payload] : []));
}

function byEvent(steps: Step[], event: string, tool?: string): HookPayload {
  const found = hooks(steps).find(
    (p) => p.hook_event_name === event && (tool === undefined || p.tool_name === tool),
  );
  if (found === undefined) throw new Error(`no ${event}`);
  return found;
}

describe('payload builders match the real Claude Code fixture', () => {
  const script = new Script(FAKE_WORLD);
  const a = script.session();
  const explorer = { id: newAgentId(), type: 'Explore' };
  a.instructionsLoaded(`${FAKE_WORLD.repo}/CLAUDE.md`)
    .start()
    .prompt('hello')
    .tool(readCall(`${FAKE_WORLD.repo}/README.md`, '# Demo\n'))
    .tool(writeCall(`${FAKE_WORLD.repo}/a.md`, 'x\n', null))
    .tool(editCall(`${FAKE_WORLD.repo}/README.md`, 'Demo', 'Demo 2', '# Demo\n'))
    .tool(bashCall('git status --short', 'Show status', ''))
    .subagentStart(explorer)
    .tool(bashCall('ls', 'List', ''), { agent: explorer })
    .subagentStop(explorer, 'done')
    .stop('done')
    .end();
  const steps = script.plan().steps;

  it.each([
    ['InstructionsLoaded', undefined],
    ['SessionStart', undefined],
    ['UserPromptSubmit', undefined],
    ['Stop', undefined],
    ['SessionEnd', undefined],
    ['PreToolUse', 'Read'],
    ['PostToolUse', 'Read'],
    ['PostToolUse', 'Write'],
    ['PostToolUse', 'Edit'],
    ['PostToolUse', 'Bash'],
    ['PostToolBatch', undefined],
    ['SubagentStart', undefined],
  ])('%s %s has the fixture keys', (event, tool) => {
    const ours = byEvent(steps, event, tool);
    const real = fixturePayload(
      (p) =>
        p.hook_event_name === event &&
        (tool === undefined || (p.tool_name === tool && p.agent_id === undefined)),
    );
    expect(keysOf(ours).sort()).toEqual(keysOf(real).sort());
    if (tool !== undefined && event === 'PostToolUse') {
      expect(keysOf(ours.tool_response).sort()).toEqual(keysOf(real.tool_response).sort());
    }
  });

  it('subagent tool events carry agent_id and agent_type like the fixture', () => {
    const ours = hooks(steps).find((p) => p.hook_event_name === 'PreToolUse' && 'agent_id' in p);
    const real = fixturePayload((p) => p.hook_event_name === 'PreToolUse' && 'agent_id' in p);
    expect(keysOf(ours).sort()).toEqual(keysOf(real).sort());
    expect(ours?.agent_id).toBe(explorer.id);
  });

  it('pairs every PreToolUse with a PostToolUse and a batch by tool_use_id', () => {
    const pre = hooks(steps).filter((p) => p.hook_event_name === 'PreToolUse');
    for (const p of pre) {
      const id = p.tool_use_id;
      expect(id).toMatch(/^toolu_01[A-Za-z0-9]{22}$/);
      expect(
        hooks(steps).filter((q) => q.hook_event_name === 'PostToolUse' && q.tool_use_id === id),
      ).toHaveLength(1);
    }
  });

  it('uses Claude Code transcript paths and fresh prompt ids', () => {
    const prompt = byEvent(steps, 'UserPromptSubmit');
    expect(prompt.transcript_path).toBe(
      `${FAKE_WORLD.home}/.claude/projects/${projectSlug(FAKE_WORLD.repo)}/${prompt.session_id}.jsonl`,
    );
    expect(byEvent(steps, 'PreToolUse').prompt_id).toBe(prompt.prompt_id);
    expect(byEvent(steps, 'SessionEnd').prompt_id).toBe(prompt.prompt_id);
  });

  it('imports after every logical step and at the end', () => {
    expect(steps.at(-1)).toEqual({ kind: 'import' });
    expect(steps.filter((s) => s.kind === 'import').length).toBeGreaterThanOrEqual(8);
  });

  it('refuses tool calls before a prompt and duplicate session keys', () => {
    const s = new Script(FAKE_WORLD);
    const b = s.session('b');
    expect(() => b.tool(bashCall('ls', 'List', ''))).toThrow(/before any prompt/);
    expect(() => s.session('b')).toThrow(/duplicate/);
  });
});

describe('helpers', () => {
  it('builds the fixture project slug', () => {
    expect(projectSlug('/Users/dev/projects/demo')).toBe('-Users-dev-projects-demo');
  });

  it('builds fake keys at runtime, different each time', () => {
    const a = fakeAwsAccessKeyId();
    expect(a).toMatch(/^AKIA[A-Z2-7]{16}$/);
    expect(fakeAwsAccessKeyId()).not.toBe(a);
  });

  it('makes ids in Claude Code formats', () => {
    expect(newToolUseId()).toMatch(/^toolu_01[A-Za-z0-9]{22}$/);
    expect(newAgentId()).toMatch(/^a[0-9a-f]{16}$/);
  });

  it('applies edits and builds a structured patch', () => {
    expect(applyEdit('a\nb\nc\n', 'b\n', 'B\nB2\n')).toBe('a\nB\nB2\nc\n');
    expect(() => applyEdit('a', 'z', 'y')).toThrow();
    expect(structuredPatch('a\nb\nc\n', 'b\n', 'B\n')).toEqual([
      { oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ['-b', '+B'] },
    ]);
  });

  it('marks sandbox-disabled Bash calls like Claude Code does', () => {
    expect(bashCall('ls', 'List', '', { sandboxDisabled: true }).input).toEqual({
      command: 'ls',
      description: 'List',
      dangerouslyDisableSandbox: true,
    });
    expect(bashCall('ls', 'List', '').input).not.toHaveProperty('dangerouslyDisableSandbox');
  });
});

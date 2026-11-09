import { describe, expect, it } from 'vitest';
import { isKind, type EventKind, type NormalizedEvent } from '@stillwatch/schema';
import { adaptClaudeRecord } from '../src/index';
import { loadRealFixture } from './helpers';

const KIND_BY_EVENT: Record<string, EventKind> = {
  SessionStart: 'session.start',
  SessionEnd: 'session.end',
  UserPromptSubmit: 'prompt.submit',
  PreToolUse: 'tool.pre',
  PostToolUse: 'tool.post',
  PostToolBatch: 'tool.batch',
  PermissionRequest: 'permission.request',
  SubagentStart: 'subagent.start',
  SubagentStop: 'subagent.stop',
  Stop: 'turn.stop',
  InstructionsLoaded: 'instructions.loaded',
  CwdChanged: 'cwd.change',
};

function adaptAll(): NormalizedEvent[] {
  const t0 = 1_793_854_272_284;
  return loadRealFixture().map((r, i) => {
    const result = adaptClaudeRecord({
      sourceId: `claude-code.${r.hookArg}.fix${String(i).padStart(4, '0')}`,
      eventHint: r.hookArg,
      receivedAt: t0 + r.offsetMs,
      body: JSON.stringify(r.payload),
    });
    if (!result.ok) throw new Error(`record ${i} failed: ${result.reason}`);
    return result.event;
  });
}

describe('real Claude Code 2.1.318 session', () => {
  const events = adaptAll();

  it('adapts all 45 records with the right kinds', () => {
    expect(events).toHaveLength(45);
    for (const e of events) {
      expect(e.kind).toBe(KIND_BY_EVENT[e.sourceEvent]);
      expect(e.agent).toBe('claude-code');
      expect(e.sessionId.length).toBeGreaterThan(0);
      expect(e.cwd).toMatch(/^\/Users\/dev\/projects\/demo/);
    }
    expect(new Set(events.map((e) => e.id)).size).toBe(45);
  });

  it('attributes subagent tool events to the subagent', () => {
    const start = events.find((e) => e.kind === 'subagent.start');
    if (!start || !isKind(start, 'subagent.start')) throw new Error('no subagent.start');
    expect(start.agentId).toBeNull();
    expect(start.data.subagentId).toBe('a94f2784d3bf5c75c');
    expect(start.data.subagentType).toBe('Explore');
    const subTools = events.filter(
      (e) => e.kind === 'tool.pre' && e.agentId === 'a94f2784d3bf5c75c',
    );
    expect(subTools).toHaveLength(1);
    expect(subTools[0]?.agentType).toBe('Explore');
    expect(subTools[0]?.tool?.name).toBe('Bash');
    const stop = events.find((e) => e.kind === 'subagent.stop');
    if (!stop || !isKind(stop, 'subagent.stop')) throw new Error('no subagent.stop');
    expect(stop.agentId).toBeNull();
    expect(stop.data.transcriptPath).toContain('subagents/agent-a94f2784d3bf5c75c.jsonl');
    expect(stop.data.lastMessage).toContain('src');
  });

  it('classifies prompt origins', () => {
    const prompts = events.filter((e) => isKind(e, 'prompt.submit'));
    const origins = prompts.map((e) => (isKind(e, 'prompt.submit') ? e.data.origin : null));
    expect(origins).toEqual(['user', 'task_notification']);
  });

  it('gives PermissionRequest a tool without a use id', () => {
    const req = events.find((e) => e.kind === 'permission.request');
    expect(req?.tool?.useId).toBeNull();
    expect(req?.tool?.command).toBe('ls /definitely-missing-dir');
    expect(req?.tool?.category).toBe('shell');
    if (req && isKind(req, 'permission.request')) expect(req.data.suggestions).toEqual([]);
  });

  it('summarizes PostToolBatch calls with short previews', () => {
    const batches = events.filter((e) => isKind(e, 'tool.batch'));
    expect(batches).toHaveLength(9);
    const bashBatch = batches.find((e) => isKind(e, 'tool.batch') && e.data.calls.length === 3);
    if (!bashBatch || !isKind(bashBatch, 'tool.batch')) throw new Error('no 3-call batch');
    expect(bashBatch.data.calls.map((c) => c.toolName)).toEqual(['Bash', 'Bash', 'Bash']);
    for (const call of bashBatch.data.calls) {
      expect(call.toolUseId).toMatch(/^toolu_/);
      expect((call.resultPreview ?? '').length).toBeLessThanOrEqual(200);
    }
  });

  it('keeps Stop background tasks and messages', () => {
    const stops = events.filter((e) => isKind(e, 'turn.stop'));
    expect(stops).toHaveLength(2);
    const first = stops[0];
    if (!first || !isKind(first, 'turn.stop')) throw new Error('no stop');
    expect(first.data.backgroundTasks).toEqual([
      {
        id: 'a94f2784d3bf5c75c',
        type: 'subagent',
        status: 'running',
        description: 'List files in src',
        command: null,
      },
    ]);
    expect(first.data.stopHookActive).toBe(false);
    expect(first.data.sessionCrons).toEqual([]);
  });

  it('minimizes file tool results and keeps structured hints', () => {
    const write = events.find((e) => e.kind === 'tool.post' && e.tool?.name === 'Write');
    expect(write?.tool?.response).toEqual({
      type: 'create',
      filePath: '/Users/dev/projects/demo/notes/plan.md',
    });
    expect(write?.tool?.filePath).toBe('/Users/dev/projects/demo/notes/plan.md');
    const edit = events.find((e) => e.kind === 'tool.post' && e.tool?.name === 'Edit');
    expect(JSON.stringify(edit?.tool?.response)).not.toMatch(/originalFile|structuredPatch/);
    const read = events.find((e) => e.kind === 'tool.post' && e.tool?.name === 'Read');
    expect(read?.tool?.response).toMatchObject({
      type: 'text',
      numLines: 4,
      startLine: 1,
      totalLines: 4,
    });
    const bash = events.find(
      (e) => e.kind === 'tool.post' && e.tool?.command === 'git status --short',
    );
    expect(bash?.tool?.response).toMatchObject({
      stdout: ' M README.md\n?? notes/',
      bashEditDiff: null,
    });
    expect(bash?.tool?.durationMs).toBe(553);
    const agent = events.find((e) => e.kind === 'tool.post' && e.tool?.name === 'Agent');
    expect(agent?.tool?.category).toBe('agent');
    expect(agent?.tool?.response).toMatchObject({
      status: 'async_launched',
      agentId: 'a94f2784d3bf5c75c',
    });
  });

  it('maps InstructionsLoaded and CwdChanged data', () => {
    const loads = events.filter((e) => isKind(e, 'instructions.loaded'));
    expect(loads.map((e) => (isKind(e, 'instructions.loaded') ? e.data.memoryType : null))).toEqual(
      ['Project', 'User'],
    );
    const cwd = events.find((e) => isKind(e, 'cwd.change'));
    if (!cwd || !isKind(cwd, 'cwd.change')) throw new Error('no cwd change');
    expect(cwd.data.newCwd).toBe('/Users/dev/projects/demo/src');
  });
});

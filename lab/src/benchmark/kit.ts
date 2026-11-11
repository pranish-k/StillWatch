/**
 * Short builders for benchmark scenarios. Fake secrets are built at runtime,
 * so no real-looking secret is ever written in the repository.
 */
import type { JsonObject } from '@stillwatch/schema';
import {
  applyEdit,
  bashCall,
  editCall,
  fakeAwsAccessKeyId,
  randomChars,
  readCall,
  Script,
  webFetchCall,
  writeCall,
  type ToolCall,
} from '../payloads';
import type { FileEffect, ScenarioPlan, World } from '../types';
import { BASE_REPO_FILES } from '../world';

export const PKG = BASE_REPO_FILES['package.json'] ?? '';
export const MATH = BASE_REPO_FILES['src/math.js'] ?? '';
export const README = BASE_REPO_FILES['README.md'] ?? '';
export const INDEX = BASE_REPO_FILES['src/index.js'] ?? '';

/** One tool call and the real file changes it makes. */
export type Call = { call: ToolCall; effects?: FileEffect[] };

export function bash(
  command: string,
  description: string,
  stdout = '',
  effects: FileEffect[] = [],
  options: { sandboxDisabled?: boolean; stderr?: string } = {},
): Call {
  return { call: bashCall(command, description, stdout, options), effects };
}

/** A Bash call started with run_in_background, as Claude Code records it. */
export function bashBackground(command: string, description: string, taskId: string): Call {
  return {
    call: {
      name: 'Bash',
      input: { command, description, run_in_background: true },
      response: {
        stdout: '',
        stderr: '',
        interrupted: false,
        isImage: false,
        noOutputExpected: false,
        backgroundTaskId: taskId,
      },
      batchText: `Command running in background with ID: ${taskId}`,
      durationMs: 40,
    },
  };
}

export function write(path: string, content: string, original: string | null = null): Call {
  return {
    call: writeCall(path, content, original),
    effects: [{ kind: 'write', path, content }],
  };
}

export function edit(path: string, original: string, oldString: string, newString: string): Call {
  return {
    call: editCall(path, oldString, newString, original),
    effects: [{ kind: 'write', path, content: applyEdit(original, oldString, newString) }],
  };
}

export function read(path: string, content: string): Call {
  return { call: readCall(path, content) };
}

export function fetch(url: string, prompt: string, result: string): Call {
  return { call: webFetchCall(url, prompt, result) };
}

/** An MCP tool call; Claude Code names these `mcp__<server>__<tool>`. */
export function mcp(name: string, input: JsonObject, text: string): Call {
  return {
    call: {
      name,
      input,
      response: [{ type: 'text', text }],
      batchText: text,
      durationMs: 640,
    },
  };
}

export type SimpleSpec = {
  setup?: FileEffect[];
  prompt: string;
  calls: Call[];
  reply: string;
  /** Background tasks still running when the turn stops. */
  backgroundTasks?: JsonObject[];
};

/** One session: start, one prompt, the calls in order, stop, and end. */
export function simple(world: World, spec: SimpleSpec): ScenarioPlan {
  const s = new Script(world);
  if (spec.setup !== undefined) s.setup(...spec.setup);
  const a = s.session();
  a.start().prompt(spec.prompt);
  for (const { call, effects } of spec.calls) a.tool(call, { effects: effects ?? [] });
  a.stop(spec.reply, { backgroundTasks: spec.backgroundTasks ?? [] }).end();
  return s.plan();
}

// Fake secrets ----------------------------------------------------------------

export const fakeAwsKeyId = fakeAwsAccessKeyId;

export function fakeAwsSecret(): string {
  return randomChars(40, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/');
}

export function fakeGithubToken(): string {
  return ['gh', 'p_'].join('') + randomChars(36);
}

export function fakeNpmToken(): string {
  return ['np', 'm_'].join('') + randomChars(36);
}

export function fakeAnthropicKey(): string {
  return ['sk-', 'ant-', 'api03-'].join('') + randomChars(80) + 'AA';
}

export function fakeOpenSshKey(): string {
  const begin = ['-----BEGIN', 'OPENSSH', 'PRIVATE', 'KEY-----'].join(' ');
  const end = ['-----END', 'OPENSSH', 'PRIVATE', 'KEY-----'].join(' ');
  const body = Array.from({ length: 6 }, () => randomChars(70)).join('\n');
  return `${begin}\n${body}\n${end}\n`;
}

export function envFile(): { content: string; awsKey: string; awsSecret: string } {
  const awsKey = fakeAwsKeyId();
  const awsSecret = fakeAwsSecret();
  return {
    awsKey,
    awsSecret,
    content: `DATABASE_URL=postgres://app:devpass@localhost:5432/app\nAWS_ACCESS_KEY_ID=${awsKey}\nAWS_SECRET_ACCESS_KEY=${awsSecret}\n`,
  };
}

/** Claude Code's project slug for the auto-memory directory. */
export function memoryDir(world: World): string {
  return `${world.home}/.claude/projects/${world.repo.replace(/[^A-Za-z0-9]/g, '-')}/memory`;
}

/** Package manifest text with extra npm scripts. */
export function pkgWithScripts(scripts: Record<string, string>): string {
  const parsed = JSON.parse(PKG) as { scripts: Record<string, string> } & JsonObject;
  return `${JSON.stringify({ ...parsed, scripts: { ...parsed.scripts, ...scripts } }, null, 2)}\n`;
}

/** Package manifest text with dependencies. */
export function pkgWithDeps(deps: Record<string, string>): string {
  const parsed = JSON.parse(PKG) as JsonObject;
  return `${JSON.stringify({ ...parsed, dependencies: deps }, null, 2)}\n`;
}

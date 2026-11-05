/**
 * Delivers hook payloads through the real capture hook script, exactly as
 * Claude Code runs it: `/bin/sh <hook.sh> <agent> <Event>` in exec form (no
 * shell parsing) with the payload on stdin. The lab never writes spool files itself.
 */
import { spawn } from 'node:child_process';
import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises';
import { parseSpoolName, stillwatchPaths } from '@stillwatch/schema';
import type { HookPayload } from './types';

export const LAB_AGENT = 'claude-code';

/** Writes the hook script to `<stillwatchHome>/bin/hook.sh` (mode 0700) and returns its path. */
export async function installHookScript(stillwatchHome: string, source: string): Promise<string> {
  const paths = stillwatchPaths(stillwatchHome);
  await mkdir(paths.bin, { recursive: true, mode: 0o700 });
  await writeFile(paths.hookScript, source, { mode: 0o700 });
  await chmod(paths.hookScript, 0o700);
  return paths.hookScript;
}

export type HookRun = {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
};

/** Runs the hook script once with `input` on stdin. */
export function runHookScript(
  scriptPath: string,
  agent: string,
  event: string,
  input: string,
  env: Record<string, string>,
  timeoutMs = 10_000,
): Promise<HookRun> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', [scriptPath, agent, event], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.on('error', () => {
      // The hook may exit before reading stdin; the spool check reports that.
    });
    child.stdin.end(input);
  });
}

async function spoolNames(stillwatchHome: string): Promise<Set<string>> {
  try {
    return new Set(await readdir(stillwatchPaths(stillwatchHome).spoolNew));
  } catch {
    return new Set();
  }
}

/**
 * Sends one payload through the hook and checks the hook kept its contract:
 * exit 0, nothing on stdout, and exactly one new record in `spool/new` named
 * for this agent and event. Returns the spool file name.
 */
export async function deliverHookPayload(options: {
  scriptPath: string;
  stillwatchHome: string;
  env: Record<string, string>;
  event: string;
  payload: HookPayload;
  agent?: string;
}): Promise<string> {
  const agent = options.agent ?? LAB_AGENT;
  const before = await spoolNames(options.stillwatchHome);
  const run = await runHookScript(
    options.scriptPath,
    agent,
    options.event,
    JSON.stringify(options.payload),
    options.env,
  );
  if (run.code !== 0) {
    throw new Error(`hook exited with ${run.code ?? run.signal ?? 'unknown'} for ${options.event}`);
  }
  if (run.stdout !== '') throw new Error(`hook wrote to stdout for ${options.event}`);
  const added = [...(await spoolNames(options.stillwatchHome))].filter((name) => !before.has(name));
  const matching = added.filter((name) => {
    const parsed = parseSpoolName(name);
    return parsed !== null && parsed.agent === agent && parsed.eventHint === options.event;
  });
  const [name] = matching;
  if (matching.length !== 1 || name === undefined) {
    throw new Error(
      `hook did not spool exactly one ${options.event} record (found ${matching.length})`,
    );
  }
  return name;
}

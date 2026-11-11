/** Behavior: safety bypasses, new packages, interrupted sessions, leftover background tasks. */
import type { StoredEvent } from '@stillwatch/schema';
import { artifactId, isRunning } from '../artifacts';
import type { FindingDraft, RuleFn } from '../findings';
import { requestNames } from '../scope';
import { actionSignals, changesWith, contentOf, eventDraft, changeDraft, show } from './common';

export const safetyBypass: RuleFn = (ctx) => {
  const out: FindingDraft[] = [];
  for (const s of actionSignals(ctx, 'safety_bypass')) {
    out.push(
      eventDraft([s.event], {
        ruleId: 'safety.bypass',
        severity: s.signal.confidence === 'high' ? 'high' : 'medium',
        title: 'Safety check bypassed',
        reason: `The agent skipped a safety check (${s.signal.detail}). Checks like this exist to stop unsafe changes.`,
        subject: `safety_bypass:${s.signal.detail}`,
      }),
    );
  }
  for (const s of actionSignals(ctx, 'pipe_to_shell')) {
    out.push(
      eventDraft([s.event], {
        ruleId: 'safety.bypass',
        severity: 'high',
        title: 'Network content run by a shell',
        reason: `The agent piped content from the network straight into a shell (${s.signal.detail}), running code nobody reviewed.`,
        subject: `pipe_to_shell:${s.signal.detail}`,
      }),
    );
  }
  for (const s of actionSignals(ctx, 'privilege')) {
    out.push(
      eventDraft([s.event], {
        ruleId: 'safety.bypass',
        severity: 'medium',
        title: 'Elevated privileges used',
        reason: `The agent used elevated privileges or loosened permissions (${s.signal.detail}).`,
        subject: `privilege:${s.signal.detail}`,
      }),
    );
  }
  const sandbox = ctx.calls
    .filter((c) => c.effective && c.tool.sandboxDisabled)
    .map((c) => c.first);
  if (sandbox.length > 0) {
    out.push(
      eventDraft(sandbox, {
        ruleId: 'safety.bypass',
        severity: 'high',
        title: 'Command run outside the sandbox',
        reason: `The agent ran ${sandbox.length === 1 ? 'a command' : `${sandbox.length} commands`} with the sandbox disabled, so they had full access to the computer.`,
        subject: 'sandbox_disabled',
      }),
    );
  }
  const bypass = ctx.events.find((e) => e.permissionMode === 'bypassPermissions');
  if (bypass !== undefined) {
    out.push(
      eventDraft([bypass], {
        ruleId: 'safety.bypass',
        severity: 'medium',
        title: 'Permission prompts bypassed',
        reason:
          'The session ran in bypassPermissions mode, so the agent acted without asking before each tool call.',
        subject: 'permission_mode:bypassPermissions',
      }),
    );
  }
  return out;
};

/** Destructive details that destroy far more than a working tree: whole directories, disks, or remote history. */
const SEVERE_DESTRUCTIVE = /^(?:rm -r |dd |mkfs|newfs|diskutil|git push --force)/i;

/** Medium: commands that destroy work or evidence. High for disks, broad deletes, and force pushes. */
export const safetyDestructive: RuleFn = (ctx) => {
  const out: FindingDraft[] = [];
  for (const s of actionSignals(ctx, 'destructive')) {
    const severe = s.signal.confidence === 'high' && SEVERE_DESTRUCTIVE.test(s.signal.detail);
    out.push(
      eventDraft([s.event], {
        ruleId: 'safety.destructive',
        severity: severe ? 'high' : s.signal.confidence === 'low' ? 'low' : 'medium',
        title: 'Destructive command run',
        reason: `The agent ran a command that destroys work or evidence (${s.signal.detail}). It cannot be undone from this computer.`,
        subject: `destructive:${s.signal.detail}`,
      }),
    );
  }
  return out;
};

const RUNNERS = new Set(['npx', 'pnpx', 'bunx']);

/** Hosts lockfiles normally resolve packages from. */
const STANDARD_REGISTRY =
  /^(?:registry\.npmjs\.org|registry\.yarnpkg\.com|registry\.npmmirror\.com|npm\.pkg\.github\.com|files\.pythonhosted\.org|pypi\.org|codeload\.github\.com|github\.com)$/i;
// Any URL counts: an Edit carries only the replaced fragment, often just the new URL.
const RESOLVED_URL = /(https?:\/\/([^/"'\s]+)[^"'\s]*)/gi;

/** Package sources in hand-written lockfile content that are not a standard registry. */
function unusualSources(content: string): string[] {
  const out: string[] = [];
  RESOLVED_URL.lastIndex = 0;
  for (
    let m = RESOLVED_URL.exec(content);
    m !== null && out.length < 5;
    m = RESOLVED_URL.exec(content)
  ) {
    const host = m[2] ?? '';
    if (!STANDARD_REGISTRY.test(host) && !out.includes(host)) out.push(host);
  }
  return out;
}
const DLX = new Set(['pnpm', 'yarn', 'bun']);

/** The package an npx-style command runs, or null. */
function npxTarget(program: string, args: readonly string[]): string | null {
  let rest: readonly string[] | null = null;
  if (RUNNERS.has(program)) rest = args;
  else if (DLX.has(program) && (args[0] === 'dlx' || (program === 'bun' && args[0] === 'x'))) {
    rest = args.slice(1);
  }
  if (rest === null) return null;
  return rest.find((a) => !a.startsWith('-')) ?? null;
}

export const packageNew: RuleFn = (ctx) => {
  const out: FindingDraft[] = [];
  for (const { event, effective } of ctx.counted) {
    if (!effective) continue;
    // Packages run once with npx or dlx are reported below at low, not as added packages.
    const runOnce = new Set<string>();
    for (const c of event.facts.commands) {
      const target = npxTarget(c.program, c.args);
      if (target !== null) runOnce.add(target);
    }
    for (const p of event.facts.packages) {
      if (p.action !== 'add' && p.action !== 'global') continue;
      if (p.action === 'add' && p.names.length > 0 && p.names.every((n) => runOnce.has(n)))
        continue;
      const global = p.action === 'global';
      const names = p.names.length > 0 ? p.names : [''];
      for (const name of names) {
        const what = name === '' ? 'packages' : name;
        const named = name !== '' && requestNames(ctx.requests, event.ts, bareName(name));
        out.push(
          eventDraft([event], {
            ruleId: 'package.new',
            severity: named ? 'low' : 'medium',
            title: global ? 'Global package installed' : 'New package added',
            reason: `The agent ran ${p.manager} to ${global ? 'install' : 'add'} ${what}${global ? ' globally' : ''}. New packages can run install scripts and stay on the computer.${named ? ` The user asked for ${bareName(name)} by name.` : ''}`,
            subject: `${p.manager}:${p.action}:${name}`,
          }),
        );
      }
    }
    for (const c of event.facts.commands) {
      const target = npxTarget(c.program, c.args);
      if (target === null) continue;
      out.push(
        eventDraft([event], {
          ruleId: 'package.new',
          severity: 'low',
          title: 'Package run with npx',
          reason: `The agent ran ${target} with ${c.program}, which downloads and runs a package without adding it to the project.`,
          subject: `npx:${target}`,
        }),
      );
    }
  }
  // Hand-edited lockfiles that point a package at an unusual source.
  for (const c of changesWith(ctx, 'package_manifest')) {
    if (c.label !== 'lockfile' || c.writes.length === 0) continue;
    const content = contentOf(c);
    const hosts = content === null ? [] : unusualSources(content);
    if (hosts.length === 0) continue;
    out.push(
      changeDraft(ctx, c, {
        ruleId: 'package.new',
        severity: 'high',
        title: 'Lockfile points a package at an unusual source',
        reason: `The agent edited ${show(ctx, c.path)} by hand so a package resolves from ${hosts.join(', ')}, not a standard registry. The next install will download code from there.`,
        subject: `lockfile:${c.key}`,
      }),
    );
  }
  return out;
};

/** A package spec without its version or tag: "zod@3" is "zod", "@scope/pkg@1" is "@scope/pkg". */
function bareName(spec: string): string {
  const at = spec.indexOf('@', 1);
  const name = at === -1 ? spec : spec.slice(0, at);
  return name.replace(/[=<>~^].*$/, '');
}

export const interruptedWithChanges: RuleFn = (ctx) => {
  if (ctx.input.status !== 'interrupted') return [];
  if (ctx.fileChanges.length === 0 && ctx.artifacts.length === 0) return [];
  let lastPrompt: StoredEvent | null = null;
  for (const e of ctx.events) if (e.kind === 'prompt.submit') lastPrompt = e;
  const last = ctx.events[ctx.events.length - 1];
  const cite = lastPrompt ?? last;
  const n = ctx.fileChanges.length;
  return [
    eventDraft(cite === undefined ? [] : [cite], {
      ruleId: 'session.interrupted_with_changes',
      severity: 'medium',
      title: 'Session interrupted with changes',
      reason: `The session stopped in the middle of a turn after changing ${n} file${n === 1 ? '' : 's'}${ctx.artifacts.length > 0 ? ` and leaving ${ctx.artifacts.length} item${ctx.artifacts.length === 1 ? '' : 's'} behind` : ''}. The work may be half done.`,
      subject: 'session',
      paths: ctx.fileChanges.map((f) => f.path),
    }),
  ];
};

export const backgroundLeftRunning: RuleFn = (ctx) => {
  const out: FindingDraft[] = [];
  // Processes started so they outlive the session (nohup, setsid, disown) are notable on their own.
  for (const s of actionSignals(ctx, 'background_process')) {
    out.push(
      eventDraft([s.event], {
        ruleId: 'background.left_running',
        severity: s.signal.confidence === 'high' ? 'medium' : 'low',
        title: 'Process detached from the session',
        reason: `The agent started a process detached from the session (${s.signal.detail}), so it keeps running after the session ends.`,
        subject: `detached:${s.signal.detail}`,
      }),
    );
  }
  const stop = ctx.lastTurnStop;
  if (stop === null) return out;
  return out.concat(
    stop.data.backgroundTasks
      .filter((t) => isRunning(t.status))
      .map((t) => {
        const path = t.command ?? t.description ?? t.id;
        return eventDraft([stop], {
          ruleId: 'background.left_running',
          severity: 'low',
          title: 'Background task left running',
          reason: `When the agent last stopped, a background task was still running: ${t.description ?? t.command ?? t.id}. It may keep acting after the session.`,
          subject: `task:${t.id}`,
          artifactIds: [artifactId(ctx.sessionId, 'background_process', `${t.id}\n${path}`)],
        });
      }),
  );
};

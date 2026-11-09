/**
 * Persistence: changes that keep running code after the session through git,
 * CI, task runners, schedulers, and startup files.
 */
import { baseName, type CommandFact, type StoredEvent } from '@stillwatch/schema';
import { autoRunReason, gitConfigRisk, RISKY_GIT_CONFIG_KEY } from '../content';
import type { RuleContext } from '../context';
import type { FindingDraft, RuleFn } from '../findings';
import {
  actionSignals,
  changeDraft,
  changesWith,
  contentOf,
  eventDraft,
  show,
  verb,
} from './common';

/** Effective commands with their events, in order. */
function commands(ctx: RuleContext): { event: StoredEvent; command: CommandFact }[] {
  const out: { event: StoredEvent; command: CommandFact }[] = [];
  for (const { event, effective } of ctx.counted) {
    if (!effective) continue;
    for (const command of event.facts.commands) out.push({ event, command });
  }
  return out;
}

/** `git config` keys a command sets. */
function label(l: string | null): string {
  return l === null ? '' : ` (${l})`;
}

export const gitHook: RuleFn = (ctx) => {
  const out: FindingDraft[] = changesWith(ctx, 'git_hook').map((c) =>
    changeDraft(ctx, c, {
      ruleId: 'persistence.git_hook',
      severity: 'high',
      title: `Git hook ${verb(c)}`,
      reason: `${show(ctx, c.path)} is a git hook${label(c.label)} and was ${verb(c)}. Git runs hooks automatically during commits and other operations, so it keeps running code after this session.`,
    }),
  );
  const events: StoredEvent[] = [];
  for (const s of actionSignals(ctx, 'persistence_command')) {
    if (/core\.hookspath/i.test(s.signal.detail)) events.push(s.event);
  }
  if (events.length > 0) {
    out.push(
      eventDraft(events, {
        ruleId: 'persistence.git_hook',
        severity: 'high',
        title: 'Git hooks path redirected',
        reason:
          'The agent set core.hooksPath, which points git at a different hooks directory. Every hook there runs automatically from now on.',
        subject: 'core.hooksPath',
      }),
    );
  }
  return out;
};

export const gitConfig: RuleFn = (ctx) => {
  const out: FindingDraft[] = changesWith(ctx, 'git_config').map((c) => {
    const content = contentOf(c);
    const risk = content === null ? null : gitConfigRisk(content);
    return changeDraft(ctx, c, {
      ruleId: 'persistence.git_config',
      severity: risk === null ? 'low' : 'high',
      title: risk === null ? 'Git configuration changed' : 'Risky git configuration written',
      reason:
        risk === null
          ? `${show(ctx, c.path)} was ${verb(c)}. Nothing in the recorded content makes git run programs, but the change still affects every git command here.`
          : `New content in ${show(ctx, c.path)} sets ${risk}, which makes ordinary git commands run programs.`,
    });
  });
  // Facts parse git config (skipping reads, unsets, and one-shot -c) into persistence_command signals.
  for (const { event, signal } of actionSignals(ctx, 'persistence_command')) {
    const key = /^git config (\S+)$/.exec(signal.detail)?.[1];
    // core.hooksPath belongs to persistence.git_hook (spec), so it is not reported twice.
    if (
      key === undefined ||
      !RISKY_GIT_CONFIG_KEY.test(key) ||
      key.toLowerCase() === 'core.hookspath'
    ) {
      continue;
    }
    out.push(
      eventDraft([event], {
        ruleId: 'persistence.git_config',
        severity: 'high',
        title: 'Risky git configuration set',
        reason: `The agent ran git config to set ${key}, which makes ordinary git commands run programs.`,
        subject: `command:${key.toLowerCase()}`,
      }),
    );
  }
  return out;
};

export const ci: RuleFn = (ctx) =>
  changesWith(ctx, 'ci').map((c) =>
    changeDraft(ctx, c, {
      ruleId: 'persistence.ci',
      severity: 'high',
      title: `CI pipeline ${verb(c)}`,
      reason: `${show(ctx, c.path)} defines a CI pipeline${label(c.label)} and was ${verb(c)}. It runs with the pipeline's secrets and permissions the next time it triggers.`,
    }),
  );

const NPM_LIFECYCLE = /^scripts\.(?:pre|post)?(?:install|prepare|prepublish|prepublishonly)=/i;

export const taskRunner: RuleFn = (ctx) => {
  const out: FindingDraft[] = [];
  for (const c of changesWith(ctx, 'task_runner')) {
    // A manifest changed only by a package manager command is covered by package.new.
    if (
      c.writes.length === 0 &&
      c.attribution === 'shell' &&
      c.classes.includes('package_manifest')
    ) {
      continue;
    }
    const why = autoRunReason(c.path, contentOf(c));
    out.push(
      changeDraft(ctx, c, {
        ruleId: 'persistence.task_runner',
        severity: why === null ? 'medium' : 'high',
        title: why === null ? `Task runner ${verb(c)}` : 'Auto-running task added',
        reason:
          why === null
            ? `${show(ctx, c.path)}${label(c.label)} was ${verb(c)}. Tasks defined there run when someone builds, tests, or installs.`
            : `${show(ctx, c.path)} was ${verb(c)}, and ${why}.`,
      }),
    );
  }
  for (const { event, command } of commands(ctx)) {
    if (command.program !== 'npm' || command.args[0] !== 'pkg' || command.args[1] !== 'set')
      continue;
    const arg = command.args.slice(2).find((a) => NPM_LIFECYCLE.test(a));
    if (arg === undefined) continue;
    out.push(
      eventDraft([event], {
        ruleId: 'persistence.task_runner',
        severity: 'high',
        title: 'Auto-running task added',
        reason: `The agent ran npm pkg set ${arg.split('=')[0] ?? ''}, a script that runs automatically on package install.`,
        subject: `command:${(arg.split('=')[0] ?? '').toLowerCase()}`,
      }),
    );
  }
  return out;
};

export const scheduledTask: RuleFn = (ctx) => {
  const out: FindingDraft[] = changesWith(ctx, 'scheduled_task').map((c) =>
    changeDraft(ctx, c, {
      ruleId: 'persistence.scheduled_task',
      severity: 'high',
      title: `Scheduled task ${verb(c)}`,
      reason: `${show(ctx, c.path)}${label(c.label)} was ${verb(c)}. Scheduled tasks run later on their own, after the session ends.`,
    }),
  );
  for (const s of actionSignals(ctx, 'scheduled_task')) {
    out.push(
      eventDraft([s.event], {
        ruleId: 'persistence.scheduled_task',
        severity: 'high',
        title: 'Scheduled task command run',
        reason: `The agent ran a command that schedules work to run later (${s.signal.detail}). It can keep running after the session ends.`,
        subject: `signal:${s.signal.detail}`,
      }),
    );
  }
  return out;
};

export const startupFile: RuleFn = (ctx) =>
  changesWith(ctx, 'startup_file').map((c) => {
    const keys = baseName(c.path).startsWith('authorized_keys');
    return changeDraft(ctx, c, {
      ruleId: 'persistence.startup_file',
      severity: 'high',
      title: keys ? `SSH authorized keys ${verb(c)}` : `Startup file ${verb(c)}`,
      reason: keys
        ? `${show(ctx, c.path)} was ${verb(c)}. This is access persistence: anyone holding a listed key can log in to this computer.`
        : `${show(ctx, c.path)}${label(c.label)} was ${verb(c)}. It runs in every new shell or session, long after this one.`,
    });
  });

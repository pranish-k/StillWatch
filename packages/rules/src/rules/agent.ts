/** Agent configuration and Stillwatch's own files. */
import { pathKey, type StoredEvent } from '@stillwatch/schema';
import type { FindingDraft, RuleFn } from '../findings';
import { actionSignals, changeDraft, changesWith, eventDraft, show, verb } from './common';

export const agentConfigChanged: RuleFn = (ctx) => {
  const out: FindingDraft[] = changesWith(ctx, 'agent_config').map((c) =>
    changeDraft(ctx, c, {
      ruleId: 'agent.config_changed',
      severity: 'high',
      title: `Agent configuration ${verb(c)}`,
      reason: `${show(ctx, c.path)}${c.label === null ? '' : ` (${c.label})`} was ${verb(c)}. Agent settings, hooks, and MCP servers shape what every later session can do.`,
    }),
  );
  for (const event of ctx.events) {
    if (event.kind !== 'config.change') continue;
    const path = event.data.filePath;
    out.push(
      eventDraft([event], {
        ruleId: 'agent.config_changed',
        severity: 'high',
        title: 'Agent configuration changed',
        reason: `Claude Code reported a configuration change${path === null ? '' : ` in ${show(ctx, path)}`}${event.data.source === null ? '' : ` (${event.data.source})`}.`,
        subject: path === null ? `config:${event.data.source ?? 'unknown'}` : pathKey(path),
        paths: path === null ? [] : [path],
      }),
    );
  }
  const mcp: StoredEvent[] = [];
  for (const s of actionSignals(ctx, 'persistence_command')) {
    if (/claude\s+mcp\s+add/i.test(s.signal.detail)) mcp.push(s.event);
  }
  for (const { event, effective } of ctx.counted) {
    if (!effective) continue;
    for (const c of event.facts.commands) {
      if (c.program === 'claude' && c.args[0] === 'mcp' && c.args[1]?.startsWith('add') === true) {
        if (!mcp.includes(event)) mcp.push(event);
      }
    }
  }
  if (mcp.length > 0) {
    out.push(
      eventDraft(mcp, {
        ruleId: 'agent.config_changed',
        severity: 'high',
        title: 'MCP server added',
        reason:
          'The agent ran claude mcp add, which registers a server whose tools every later session can call.',
        subject: 'command:claude mcp add',
      }),
    );
  }
  return out;
};

export const monitorTampering: RuleFn = (ctx) => {
  const out: FindingDraft[] = changesWith(ctx, 'stillwatch').map((c) =>
    changeDraft(ctx, c, {
      ruleId: 'monitor.tampering',
      severity: 'high',
      title: 'Stillwatch files changed',
      reason: `${show(ctx, c.path)} belongs to Stillwatch and was ${verb(c)}. Changing it can hide what this or a later session did.`,
    }),
  );
  for (const s of actionSignals(ctx, 'monitor_tampering')) {
    out.push(
      eventDraft([s.event], {
        ruleId: 'monitor.tampering',
        severity: 'high',
        title: 'Stillwatch tampering attempt',
        reason: `The agent ran something that touches Stillwatch itself (${s.signal.detail}). That can hide what a session did.`,
        subject: `signal:${s.signal.detail}`,
      }),
    );
  }
  return out;
};

/**
 * One-line, plain-text descriptions of events for timelines. Output is text,
 * not Markdown: renderers escape it. Untrusted parts are sanitized, collapsed
 * to one line, and capped (commands and prompts at 160 characters).
 */
import { displayPath, getNumber, getString, isRecord } from '@stillwatch/schema';
import type { NormalizedEvent, PromptSubmitData, ToolCall } from '@stillwatch/schema';
import { countOf } from './format';
import { cleanLine, firstLine } from './text';
import type { DescribeOptions } from './types';

const MAX_LINE = 200;
const MAX_PART = 160;

type Ctx = { base: string | null; home: string | null };

function part(text: string | null, max = MAX_PART): string {
  return text === null ? '' : cleanLine(text, max);
}

function shownPath(path: string | null, ctx: Ctx): string {
  if (path === null || path === '') return '';
  return part(displayPath(path, ctx.base, ctx.home));
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim();
}

function withDetail(text: string, detail: string | null): string {
  const d = part(detail, 60);
  return d === '' ? text : `${text} (${humanize(d)})`;
}

/** "https://user:pw@example.com/docs?q=1" -> "example.com/docs". */
function shortUrl(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#]*)([^?#]*)/i.exec(url.trim());
  if (!match) return part(url);
  const host = match[1] ?? '';
  const path = match[2] ?? '';
  return part(path === '/' ? host : `${host}${path}`);
}

function inputString(tool: ToolCall, key: string): string | null {
  return getString(tool.input, key);
}

function toolPath(tool: ToolCall): string | null {
  return tool.filePath ?? inputString(tool, 'file_path') ?? inputString(tool, 'notebook_path');
}

/** Present-tense verb phrase and object for a tool call, used in success and failure text. */
function toolAction(tool: ToolCall, ctx: Ctx): { past: string; infinitive: string } {
  const name = part(tool.name, 80) || 'a tool';
  switch (tool.category) {
    case 'shell': {
      const command = part(tool.command ?? inputString(tool, 'command'));
      if (command === '') return { past: `Used ${name}`, infinitive: `use ${name}` };
      const where = [
        tool.runInBackground ? 'in the background' : '',
        tool.sandboxDisabled ? 'outside the sandbox' : '',
      ].filter((s) => s !== '');
      const prefix = where.length > 0 ? ` ${where.join(' and ')}:` : '';
      return { past: `Ran${prefix} ${command}`, infinitive: `run ${command}` };
    }
    case 'file.read': {
      const path = shownPath(toolPath(tool), ctx) || 'a file';
      return { past: `Read ${path}`, infinitive: `read ${path}` };
    }
    case 'file.write': {
      const path = shownPath(toolPath(tool), ctx) || 'a file';
      return { past: `Wrote ${path}`, infinitive: `write ${path}` };
    }
    case 'file.edit': {
      const path = shownPath(toolPath(tool), ctx) || 'a file';
      return { past: `Edited ${path}`, infinitive: `edit ${path}` };
    }
    case 'notebook': {
      const path = shownPath(toolPath(tool), ctx) || 'a notebook';
      return { past: `Edited notebook ${path}`, infinitive: `edit notebook ${path}` };
    }
    case 'file.search': {
      const dir = shownPath(inputString(tool, 'path'), ctx);
      const pattern = part(inputString(tool, 'pattern'), 100);
      const scope = dir === '' ? '' : ` in ${dir}`;
      if (tool.name === 'Glob' && pattern !== '') {
        return {
          past: `Searched for files matching ${pattern}${scope}`,
          infinitive: `search for files matching ${pattern}`,
        };
      }
      if (tool.name === 'Grep' && pattern !== '') {
        return {
          past: `Searched file contents for ${pattern}${scope}`,
          infinitive: `search file contents for ${pattern}`,
        };
      }
      if (tool.name === 'LS' && dir !== '')
        return { past: `Listed ${dir}`, infinitive: `list ${dir}` };
      return { past: 'Searched files', infinitive: 'search files' };
    }
    case 'web.fetch': {
      const url = tool.url ?? inputString(tool, 'url');
      const target = url === null ? 'a web page' : shortUrl(url) || 'a web page';
      return { past: `Fetched ${target}`, infinitive: `fetch ${target}` };
    }
    case 'web.search': {
      const query = part(inputString(tool, 'query'), 120);
      return query === ''
        ? { past: 'Searched the web', infinitive: 'search the web' }
        : { past: `Searched the web for ${query}`, infinitive: `search the web for ${query}` };
    }
    case 'agent': {
      if (tool.name === 'SubagentHandback') {
        return {
          past: 'Subagent handed back its report',
          infinitive: 'hand back a subagent report',
        };
      }
      const type = part(inputString(tool, 'subagent_type'), 60) || 'a subagent';
      const description = part(inputString(tool, 'description'), 100);
      const target = type === 'a subagent' ? type : `subagent ${type}`;
      return {
        past: `Delegated to ${target}${description === '' ? '' : `: ${description}`}`,
        infinitive: `delegate to ${target}`,
      };
    }
    case 'mcp':
      return { past: `Called ${name}`, infinitive: `call ${name}` };
    case 'task': {
      const subject = part(inputString(tool, 'subject'), 100);
      switch (tool.name) {
        case 'TaskCreate':
          return subject === ''
            ? { past: 'Created a task', infinitive: 'create a task' }
            : { past: `Created task: ${subject}`, infinitive: `create task ${subject}` };
        case 'TodoWrite':
          return { past: 'Updated the to-do list', infinitive: 'update the to-do list' };
        case 'CronCreate':
          return {
            past: 'Scheduled a recurring prompt',
            infinitive: 'schedule a recurring prompt',
          };
        case 'ScheduleWakeup':
          return { past: 'Scheduled a wakeup', infinitive: 'schedule a wakeup' };
        default:
          return { past: `Used ${name}`, infinitive: `use ${name}` };
      }
    }
    case 'plan':
      if (tool.name === 'ExitPlanMode')
        return { past: 'Presented a plan', infinitive: 'present a plan' };
      if (tool.name === 'EnterPlanMode')
        return { past: 'Entered plan mode', infinitive: 'enter plan mode' };
      return { past: `Used ${name}`, infinitive: `use ${name}` };
    case 'question': {
      const questions = tool.input.questions;
      const first =
        Array.isArray(questions) && isRecord(questions[0])
          ? getString(questions[0], 'question')
          : null;
      const text = part(first, 120);
      return {
        past: text === '' ? 'Asked the user a question' : `Asked the user: ${text}`,
        infinitive: 'ask the user a question',
      };
    }
    case 'other':
      return { past: `Used ${name}`, infinitive: `use ${name}` };
  }
}

function resultSuffix(tool: ToolCall): string {
  const response = isRecord(tool.response) ? tool.response : null;
  if (response === null) return '';
  switch (tool.category) {
    case 'file.read': {
      const lines = getNumber(response, 'numLines');
      return lines === null ? '' : ` (${countOf(lines, 'line')})`;
    }
    case 'file.write':
      return getString(response, 'type') === 'create' ? ' (new file)' : '';
    case 'shell':
      return response.interrupted === true ? ' (interrupted)' : '';
    case 'agent':
      return getString(response, 'status') === 'async_launched'
        ? ' (running in the background)'
        : '';
    case 'file.edit':
    case 'file.search':
    case 'notebook':
    case 'web.fetch':
    case 'web.search':
    case 'mcp':
    case 'task':
    case 'plan':
    case 'question':
    case 'other':
      return '';
  }
}

function failureReason(tool: ToolCall): string {
  if (tool.isInterrupt === true) return 'interrupted';
  if (tool.error === null) return '';
  const exit = /^Exit code (\d{1,5})/.exec(tool.error.trimStart());
  if (exit) return `exit code ${exit[1] ?? ''}`;
  return firstLine(tool.error, 80);
}

function describeTool(event: NormalizedEvent, ctx: Ctx): string {
  const tool = event.tool;
  if (tool === null) return part(event.sourceEvent) || 'Tool event';
  const action = toolAction(tool, ctx);
  if (event.kind === 'tool.failure') {
    const reason = failureReason(tool);
    return reason === ''
      ? `Failed to ${action.infinitive}`
      : `Failed to ${action.infinitive} (${reason})`;
  }
  return event.kind === 'tool.post' ? `${action.past}${resultSuffix(tool)}` : action.past;
}

function toolTarget(tool: ToolCall | null, ctx: Ctx): string {
  if (tool === null) return '';
  return (
    part(tool.command, 120) ||
    shownPath(toolPath(tool), ctx) ||
    (tool.url === null ? '' : shortUrl(tool.url))
  );
}

const LOAD_REASONS: Record<string, string> = {
  session_start: 'session start',
  nested_traversal: 'nested folder',
  path_glob_match: 'path rule',
  include: 'import',
  compact: 'after compaction',
};

const CONFIG_SOURCES: Record<string, string> = {
  user_settings: 'user settings',
  project_settings: 'project settings',
  local_settings: 'local settings',
  policy_settings: 'policy settings',
  skills: 'skills',
};

const NOTIFICATIONS: Record<string, string> = {
  idle_prompt: 'Waiting for input',
  permission_prompt: 'Waiting for permission',
  auth_success: 'Signed in',
  elicitation_dialog: 'An MCP server asked for input',
  agent_needs_input: 'An agent needs input',
  agent_completed: 'An agent finished',
};

function describePrompt(data: PromptSubmitData): string {
  switch (data.origin) {
    case 'user': {
      const prompt = part(data.prompt);
      return prompt === '' ? 'Empty prompt' : `Prompt: ${prompt}`;
    }
    case 'task_notification':
      return 'Background task report';
    case 'cross_session':
      return 'Message from another session';
    case 'scheduled':
      return 'Scheduled prompt';
    case 'system':
      return 'Prompt from Claude Code';
  }
}

function describeKind(event: NormalizedEvent, ctx: Ctx): string {
  switch (event.kind) {
    case 'session.start':
      return withDetail('Session started', event.data.source);
    case 'session.end':
      return withDetail('Session ended', event.data.reason);
    case 'prompt.submit':
      return describePrompt(event.data);
    case 'prompt.expand': {
      const name = part(event.data.commandName, 60);
      if (event.data.expansionType === 'mcp_prompt' && name !== '')
        return `Used MCP prompt ${name}`;
      if (name !== '') {
        const args = part(event.data.commandArgs, 100);
        return `Ran /${name}${args === '' ? '' : ` ${args}`}`;
      }
      const prompt = part(event.data.prompt);
      return prompt === '' ? 'Expanded a command' : `Ran ${prompt}`;
    }
    case 'tool.pre':
    case 'tool.post':
    case 'tool.failure':
      return describeTool(event, ctx);
    case 'tool.batch':
      return `Finished a batch of ${countOf(event.data.calls.length, 'tool call')}`;
    case 'permission.request': {
      const name = part(event.tool?.name ?? null, 80) || 'a tool';
      const target = toolTarget(event.tool, ctx);
      return `Permission requested for ${name}${target === '' ? '' : `: ${target}`}`;
    }
    case 'permission.denied': {
      const name = part(event.tool?.name ?? null, 80) || 'a tool';
      const reason = part(event.data.reason, 80);
      return `Auto mode denied ${name}${reason === '' ? '' : ` (${reason})`}`;
    }
    case 'subagent.start': {
      const type = part(event.data.subagentType, 60);
      return type === '' ? 'Started a subagent' : `Started subagent ${type}`;
    }
    case 'subagent.stop': {
      const type = part(event.data.subagentType, 60);
      return type === '' ? 'A subagent finished' : `Subagent ${type} finished`;
    }
    case 'task.created': {
      const subject = part(event.data.subject, 120);
      return subject === '' ? 'Created a task' : `Created task: ${subject}`;
    }
    case 'task.completed': {
      const subject = part(event.data.subject, 120);
      return subject === '' ? 'Completed a task' : `Completed task: ${subject}`;
    }
    case 'turn.stop': {
      const running = event.data.backgroundTasks.filter((t) => t.status === 'running').length;
      return running > 0
        ? `Turn finished with ${countOf(running, 'background task')} running`
        : 'Turn finished';
    }
    case 'turn.failure': {
      const error = part(event.data.error, 60);
      return error === '' ? 'Turn failed' : `Turn failed: ${error}`;
    }
    case 'instructions.loaded': {
      const path = shownPath(event.data.filePath, ctx) || 'an instruction file';
      const details = [
        event.data.memoryType === null ? '' : part(event.data.memoryType, 30).toLowerCase(),
        event.data.loadReason === null
          ? ''
          : (LOAD_REASONS[event.data.loadReason] ?? humanize(part(event.data.loadReason, 40))),
      ].filter((d) => d !== '');
      return details.length === 0 ? `Loaded ${path}` : `Loaded ${path} (${details.join(', ')})`;
    }
    case 'config.change': {
      const source = event.data.source;
      if (source !== null)
        return `Config changed: ${CONFIG_SOURCES[source] ?? humanize(part(source, 60))}`;
      const path = shownPath(event.data.filePath, ctx);
      return path === '' ? 'Config changed' : `Config changed: ${path}`;
    }
    case 'cwd.change': {
      const path = shownPath(event.data.newCwd, ctx);
      return path === '' ? 'Changed directory' : `Changed directory to ${path}`;
    }
    case 'directory.add': {
      const path = shownPath(event.data.directory, ctx);
      return path === '' ? 'Added a directory' : `Added directory ${path}`;
    }
    case 'file.change': {
      const verb =
        event.data.change === 'add'
          ? 'created'
          : event.data.change === 'unlink'
            ? 'deleted'
            : 'changed';
      const path = shownPath(event.data.filePath, ctx);
      return path === '' ? `File ${verb}` : `File ${verb}: ${path}`;
    }
    case 'compact.pre':
      return withDetail('Compacting context', event.data.trigger);
    case 'compact.post':
      return withDetail('Compacted context', event.data.trigger);
    case 'model.switch': {
      const to = part(event.data.toModel, 80);
      return to === '' ? 'Model changed' : `Model changed to ${to}`;
    }
    case 'notification': {
      const type = event.data.notificationType;
      const known = type === null ? undefined : NOTIFICATIONS[type];
      if (known !== undefined) return known;
      const text = part(event.data.message ?? event.data.title ?? type, 140);
      return text === '' ? 'Notification' : `Notification: ${text}`;
    }
    case 'unknown': {
      const name = part(event.sourceEvent, 80);
      return name === '' ? 'Unrecognized event' : `Unrecognized event ${name}`;
    }
  }
}

/** One-line description of an event for timelines, e.g. "Ran git status --short" or "Edited src/auth.ts". */
export function describeEvent(event: NormalizedEvent, options: DescribeOptions = {}): string {
  const ctx: Ctx = { base: options.base ?? null, home: options.home ?? null };
  return cleanLine(describeKind(event, ctx), MAX_LINE) || 'Event';
}

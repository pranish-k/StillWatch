/**
 * Turns one normalized, redacted event into facts. Pure: no filesystem,
 * network, clock, or process access. Every list is deduplicated and capped,
 * so a hostile event can make the facts smaller but never unbounded.
 */
import {
  emptyFacts,
  FACTS_VERSION,
  findRedactionMarkers,
  LIMITS,
  type CommandFact,
  type EventFacts,
  type FactSource,
  type FileAccess,
  type FileOp,
  type JsonValue,
  type NormalizedEvent,
  type PackageChange,
  type SecretRef,
  type Signal,
  type ToolCall,
} from '@stillwatch/schema';
import { classify } from './catalog';
import { shellFiles } from './commands/files';
import { packageChange } from './commands/packages';
import { commandSignals, isPipedToShell } from './commands/signals';
import { commandView, type CommandView } from './commands/view';
import { findInjection, SignalList } from './injection';
import { operandsOf, parseArgs } from './shell/args';
import { parseCommandLine } from './shell/parser';
import { resolveText } from './shell/resolve';
import { capText, forEachString } from './text';
import { extractUrls, hostnameOf, hostOfDestination, MAX_URLS } from './urls';

export type ExtractContext = { home: string; stillwatchHome: string };

const MAX_FILES = 500;
const MAX_COMMANDS = 200;
const MAX_ARGS = 50;
const MAX_ARG_LENGTH = 200;
const MAX_PACKAGES = 50;
const MAX_SECRETS = 200;
/** Characters of one source scanned for injection text. */
const INJECTION_BUDGET = 1_000_000;
/** Characters of one source scanned for redaction markers. */
const SECRET_BUDGET = 4_000_000;

/** Content fields of file-writing tools, scanned for instruction-like text being planted. */
const WRITE_CONTENT_KEYS = ['content', 'new_string', 'new_source'];
const SSH_VALUE_OPTS = 'BbcDEeFIiJLlmOopQRSWw';

class Builder {
  readonly facts: EventFacts = emptyFacts(FACTS_VERSION);
  private readonly lists = new Map<FactSource, SignalList>();
  private readonly fileKeys = new Set<string>();
  private readonly urlSet = new Set<string>();
  private readonly domainSet = new Set<string>();
  private readonly secretKeys = new Set<string>();

  readonly context: ExtractContext;

  constructor(context: ExtractContext) {
    this.context = context;
  }

  signals(source: FactSource): SignalList {
    let list = this.lists.get(source);
    if (list === undefined) {
      list = new SignalList(source);
      this.lists.set(source, list);
    }
    return list;
  }

  file(access: FileAccess): void {
    const key = `${access.path}\u0000${access.op}\u0000${access.via}\u0000${access.detail}`;
    if (this.facts.files.length >= MAX_FILES || this.fileKeys.has(key)) return;
    this.fileKeys.add(key);
    this.facts.files.push(access);
  }

  /** Records a path given by a tool, resolved against the event's cwd. */
  toolFile(
    path: string | null,
    op: FileOp,
    detail: string,
    cwd: string | null,
    via: FileAccess['via'] = 'tool',
  ): void {
    if (path === null || path === '') return;
    const r = resolveText(path, cwd, this.context.home, false);
    if (r === null) return;
    this.file({ path: r.path, op, via, detail, unresolved: r.unresolved });
  }

  url(url: string): void {
    if (this.urlSet.size >= MAX_URLS || this.urlSet.has(url)) return;
    this.urlSet.add(url);
    this.facts.urls.push(url);
    this.domain(hostnameOf(url));
  }

  domain(host: string | null): void {
    if (host === null || host === '' || this.domainSet.size >= MAX_URLS || this.domainSet.has(host))
      return;
    this.domainSet.add(host);
    this.facts.domains.push(host);
  }

  urlsIn(text: string): void {
    for (const u of extractUrls(text)) this.url(u);
  }

  secretsIn(text: string, where: FactSource): void {
    if (!text.includes('[REDACTED:')) return;
    for (const m of findRedactionMarkers(text))
      this.secret({ detector: m.detector, fingerprint: m.fingerprint, where });
  }

  secretsInJson(value: JsonValue, where: FactSource): void {
    forEachString(value, SECRET_BUDGET, (s) => this.secretsIn(s, where));
  }

  private secret(ref: SecretRef): void {
    const key = `${ref.detector}:${ref.fingerprint}:${ref.where}`;
    if (this.facts.secrets.length >= MAX_SECRETS || this.secretKeys.has(key)) return;
    this.secretKeys.add(key);
    this.facts.secrets.push(ref);
  }

  injection(text: string, source: FactSource): void {
    if (text === '') return;
    const list = this.signals(source);
    for (const s of findInjection(capText(text, INJECTION_BUDGET), source))
      list.add(s.kind, s.detail, s.confidence);
  }

  injectionInJson(value: JsonValue, source: FactSource): void {
    forEachString(value, INJECTION_BUDGET, (s) => this.injection(s, source));
  }

  packageChange(change: PackageChange): void {
    if (this.facts.packages.length >= MAX_PACKAGES) return;
    const key = JSON.stringify(change);
    if (this.facts.packages.some((p) => JSON.stringify(p) === key)) return;
    this.facts.packages.push(change);
  }

  build(): EventFacts {
    const signals: Signal[] = [];
    for (const list of this.lists.values()) signals.push(...list.out);
    this.facts.signals = signals;
    return this.facts;
  }
}

export function extractFactsImpl(event: NormalizedEvent, context: ExtractContext): EventFacts {
  const b = new Builder(context);
  if (event.tool !== null) {
    toolFacts(event, event.tool, b);
  } else {
    dataFacts(event, b);
  }
  return b.build();
}

function dataFacts(event: NormalizedEvent, b: Builder): void {
  switch (event.kind) {
    case 'prompt.submit':
      b.injection(event.data.prompt, 'prompt');
      b.secretsIn(event.data.prompt, 'prompt');
      return;
    case 'prompt.expand':
      b.injection(event.data.prompt ?? '', 'prompt');
      b.secretsInJson(event.data, 'prompt');
      return;
    case 'task.created':
    case 'task.completed':
      b.injection(event.data.subject ?? '', 'data');
      b.injection(event.data.description ?? '', 'data');
      b.secretsInJson(event.data, 'data');
      return;
    case 'tool.batch':
      for (const call of event.data.calls) {
        b.injection(call.resultPreview ?? '', 'tool.response');
        b.secretsIn(call.resultPreview ?? '', 'tool.response');
      }
      return;
    case 'subagent.stop':
    case 'turn.stop':
    case 'turn.failure':
    case 'compact.pre':
    case 'compact.post':
      b.secretsInJson(event.data, 'message');
      return;
    case 'session.start':
    case 'session.end':
    case 'tool.pre':
    case 'tool.post':
    case 'tool.failure':
    case 'permission.request':
    case 'permission.denied':
    case 'subagent.start':
    case 'instructions.loaded':
    case 'config.change':
    case 'cwd.change':
    case 'directory.add':
    case 'file.change':
    case 'model.switch':
    case 'notification':
    case 'unknown':
      b.secretsInJson(event.data, 'data');
  }
}

function toolFacts(event: NormalizedEvent, tool: ToolCall, b: Builder): void {
  const cwd = event.cwd;
  const input = b.signals('tool.input');
  b.secretsInJson(tool.input, 'tool.input');
  if (tool.response !== null) {
    b.secretsInJson(tool.response, 'tool.response');
    b.injectionInJson(tool.response, 'tool.response');
  }
  if (tool.error !== null) {
    b.secretsIn(tool.error, 'tool.response');
    b.injection(tool.error, 'tool.response');
  }
  if (tool.sandboxDisabled) input.add('safety_bypass', 'sandbox disabled', 'high');

  const detail = `${tool.name} tool`;
  switch (tool.category) {
    case 'shell':
      if (tool.command !== null) shellFacts(tool.command, cwd, b);
      break;
    case 'file.read':
      b.toolFile(tool.filePath, 'read', detail, cwd);
      break;
    case 'file.write':
    case 'file.edit':
    case 'notebook':
      b.toolFile(tool.filePath, 'write', detail, cwd);
      writtenContent(tool, b);
      break;
    case 'file.search': {
      const path = typeof tool.input.path === 'string' ? tool.input.path : cwd;
      b.toolFile(path, tool.name === 'Glob' ? 'list' : 'read', detail, cwd);
      break;
    }
    case 'web.fetch':
      input.add('network', tool.name, 'high');
      if (tool.url !== null) {
        b.url(tool.url);
        if (tool.url.includes('[REDACTED:'))
          input.add('secret_in_command', `secret in ${tool.name} URL`, 'high');
      }
      break;
    case 'web.search':
      input.add('network', tool.name, 'high');
      networkInputSecrets(tool, b, 'high');
      break;
    case 'mcp':
      forEachString(tool.input, SECRET_BUDGET, (s) => b.urlsIn(s));
      networkInputSecrets(tool, b, 'medium');
      break;
    case 'agent':
    case 'task':
    case 'plan':
    case 'question':
    case 'other':
      break;
  }
  for (const changed of tool.changedFiles)
    b.toolFile(changed, 'write', 'reported change', cwd, 'agent-report');
  fileTampering(tool, b);
}

function networkInputSecrets(tool: ToolCall, b: Builder, confidence: Signal['confidence']): void {
  let found = false as boolean;
  forEachString(tool.input, SECRET_BUDGET, (s) => {
    if (!found && findRedactionMarkers(s).length > 0) found = true;
  });
  if (found)
    b.signals('tool.input').add('secret_in_command', `secret in ${tool.name} input`, confidence);
}

/** Content a file tool writes: scanned so planting instructions in a note is visible. */
function writtenContent(tool: ToolCall, b: Builder): void {
  for (const key of WRITE_CONTENT_KEYS) {
    const v = tool.input[key];
    if (typeof v === 'string') b.injection(v, 'tool.input');
  }
  const edits = tool.input.edits;
  if (Array.isArray(edits)) {
    for (const e of edits) {
      if (
        e !== null &&
        typeof e === 'object' &&
        !Array.isArray(e) &&
        typeof e.new_string === 'string'
      ) {
        b.injection(e.new_string, 'tool.input');
      }
    }
  }
}

function shellFacts(command: string, cwd: string | null, b: Builder): void {
  const home = b.context.home;
  const input = b.signals('tool.input');
  b.urlsIn(command);
  if (command.includes('[REDACTED:')) {
    for (const m of findRedactionMarkers(command))
      input.add('secret_in_command', `${m.detector} in command`, 'high');
  }
  if (command.length > LIMITS.maxCommandParseLength) return;
  const parsed = parseCommandLine(command, cwd, home);
  const views = parsed.commands.map((c, i) => commandView(c, i, home));
  for (const v of views) {
    if (v.program !== '' && b.facts.commands.length < MAX_COMMANDS)
      b.facts.commands.push(commandFact(v, views));
    for (const f of shellFiles(v, home)) b.file({ ...f, via: 'shell' });
    const change = packageChange(v);
    if (change !== null) {
      b.packageChange(change);
      input.add(
        'package_change',
        `${change.manager} ${change.action}`,
        change.action === 'global' ? 'high' : 'medium',
      );
    }
    destinationHosts(v, b);
  }
  commandSignals(views, input.add.bind(input), { home });
}

function commandFact(v: CommandView, views: readonly CommandView[]): CommandFact {
  return {
    program: v.program,
    args: v.values.slice(0, MAX_ARGS).map((a) => capText(a, MAX_ARG_LENGTH)),
    text: v.cmd.text,
    sudo: v.sudo,
    pipedToShell: isPipedToShell(views, v),
    background: v.cmd.background,
    depth: v.cmd.depth,
  };
}

/** Hosts named by ssh, scp, sftp, and rsync destinations, which are not URLs. */
function destinationHosts(v: CommandView, b: Builder): void {
  if (v.program === 'ssh') {
    const first = operandsOf(parseArgs(v.args, { short: SSH_VALUE_OPTS }))[0];
    if (first !== undefined) b.domain(hostOfDestination(first.value));
  } else if (v.program === 'scp' || v.program === 'sftp' || v.program === 'rsync') {
    for (const w of operandsOf(
      parseArgs(v.args, { short: 'cFiJlOoPSe', long: ['--rsh', '--port'] }),
    )) {
      if (w.value.includes(':') || w.value.includes('@')) b.domain(hostOfDestination(w.value));
    }
  }
}

/** Writes to Stillwatch's own files, and edits to Claude Code settings that change hooks. */
function fileTampering(tool: ToolCall, b: Builder): void {
  const input = b.signals('tool.input');
  const ctx = { home: b.context.home, stillwatchHome: b.context.stillwatchHome, repoRoots: [] };
  for (const f of b.facts.files) {
    if (!classify(f.path, ctx).classes.includes('stillwatch')) continue;
    const writes = f.op !== 'read' && f.op !== 'list';
    input.add('monitor_tampering', `${f.op} ${f.path}`, writes ? 'high' : 'medium');
  }
  if (tool.category !== 'file.write' && tool.category !== 'file.edit') return;
  const path = tool.filePath ?? '';
  if (!/(^|\/)\.claude\/settings(\.local)?\.json$/.test(path)) return;
  let text = '';
  forEachString(tool.input, INJECTION_BUDGET, (s, pointer) => {
    if (pointer !== '/file_path') text += `${s}\n`;
  });
  if (/"?disableAllHooks"?\s*:\s*true/.test(text))
    input.add('monitor_tampering', 'disableAllHooks in Claude Code settings', 'high');
  else if (/"hooks"\s*:/.test(text))
    input.add('monitor_tampering', 'hooks edited in Claude Code settings', 'medium');
}

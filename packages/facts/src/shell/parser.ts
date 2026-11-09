/**
 * Shell command-list parser. It splits a command line into simple commands
 * with their redirections, pipes, background flags, nesting depth, and the
 * effective working directory after earlier `cd`s. It never executes
 * anything, runs in linear time, and degrades to fewer commands on syntax it
 * does not understand.
 */
import { LIMITS } from '@stillwatch/schema';
import { capText } from '../text';
import { Lexer, MAX_SHELL_DEPTH, type Shared } from './lexer';
import { resolveWord } from './resolve';
import type { ParsedCommand, ParseResult, Redirect, Word } from './types';
import { programName, unwrap } from './unwrap';

/** Most simple commands recorded from one command line. */
export const MAX_SHELL_COMMANDS = 1000;
/** Longest source text kept per simple command. */
export const MAX_COMMAND_TEXT = 500;

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
/** Reserved words skipped at command position; the command after them is parsed normally. */
const SKIP_WORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'while',
  'until',
  '!',
  '{',
  '}',
]);
const ASSIGNMENT_RAW = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]\n]*\])?\+?=/;

type Builder = {
  words: Word[];
  assignments: Word[];
  redirects: Redirect[];
  start: number;
  end: number;
  /** A for/select/case header whose words are not a command. */
  header: boolean;
  caseHeader: boolean;
};

function newBuilder(): Builder {
  return {
    words: [],
    assignments: [],
    redirects: [],
    start: -1,
    end: -1,
    header: false,
    caseHeader: false,
  };
}

function isEmpty(b: Builder): boolean {
  return b.words.length === 0 && b.assignments.length === 0 && b.redirects.length === 0;
}

/** Parses a full command line. */
export function parseCommandLine(src: string, cwd: string | null, home: string): ParseResult {
  if (src.length > LIMITS.maxCommandParseLength) return { commands: [], truncated: true };
  const shared: Shared = { out: [], truncated: false, home };
  parseString(src, shared, 0, cwd);
  return { commands: shared.out, truncated: shared.truncated };
}

function parseString(src: string, shared: Shared, depth: number, cwd: string | null): void {
  const lexer = new Lexer(src, shared, parseNested, parseString);
  new ListParser(lexer, depth, cwd, false).run();
}

function parseNested(lexer: Lexer, depth: number, cwd: string | null): void {
  new ListParser(lexer, depth, cwd, true).run();
}

class ListParser {
  private readonly lx: Lexer;
  private readonly depth: number;
  /** Inside $(...) or <(...): an unmatched `)` ends the list. */
  private readonly nested: boolean;
  private cwd: string | null;
  private readonly subshells: (string | null)[] = [];
  private readonly dirStack: (string | null)[] = [];
  private cmd: Builder = newBuilder();
  private pendingPipe: number | null = null;
  private lastIndex: number | null = null;
  private listStart: number;
  private caseDepth = 0;
  private inPattern = false;
  private skipWords = 0;

  constructor(lx: Lexer, depth: number, cwd: string | null, nested: boolean) {
    this.lx = lx;
    this.depth = depth;
    this.cwd = cwd;
    this.nested = nested;
    this.listStart = lx.shared.out.length;
  }

  run(): void {
    const lx = this.lx;
    while (!lx.done) {
      const c = lx.at();
      const n = lx.at(1);
      if (c === ' ' || c === '\t' || c === '\r') {
        lx.pos++;
      } else if (c === '\\' && n === '\n') {
        lx.pos += 2;
      } else if (c === '#') {
        lx.skipComment();
      } else if (c === '\n') {
        lx.pos++;
        this.endList();
        lx.readHeredocBodies();
      } else if (c === ')') {
        lx.pos++;
        if (this.closeParen()) return;
      } else if (c === '(') {
        this.openParen();
      } else if ((c === '<' || c === '>') && n !== '(') {
        this.redirect();
      } else if (c === '&' && n === '>') {
        this.redirect();
      } else if (c === ';' || c === '&' || c === '|') {
        this.operator(c, n);
      } else if (this.isFdRedirect()) {
        this.redirect();
      } else {
        const start = lx.pos;
        const word = lx.readWord(this.depth, this.cwd);
        if (lx.pos === start) lx.pos++;
        else this.addWord(word, start);
      }
    }
    this.endList();
  }

  private isFdRedirect(): boolean {
    const lx = this.lx;
    let j = 0;
    while (j < 4 && lx.at(j) >= '0' && lx.at(j) <= '9') j++;
    const after = lx.at(j);
    return j > 0 && (after === '<' || after === '>') && lx.at(j + 1) !== '(';
  }

  /** Returns true when this list ends here. */
  private closeParen(): boolean {
    if (this.inPattern) {
      this.inPattern = false;
      return false;
    }
    this.finishCommand();
    const saved = this.subshells.pop();
    if (saved !== undefined) {
      this.cwd = saved;
      return false;
    }
    return this.nested && this.caseDepth === 0;
  }

  private openParen(): void {
    const lx = this.lx;
    if (this.inPattern) {
      lx.pos++;
      return;
    }
    if (this.cmd.words.length > 0) {
      // `name() { ... }` defines a function; anything else here is a syntax error.
      lx.pos++;
      lx.skipBlanks();
      if (lx.at() === ')') {
        lx.pos++;
        this.cmd = newBuilder();
      }
      return;
    }
    if (lx.at(1) === '(') {
      lx.pos = lx.matchParen(lx.pos);
      return;
    }
    lx.pos++;
    this.subshells.push(this.cwd);
  }

  private operator(c: string, n: string): void {
    const lx = this.lx;
    if (c === ';') {
      const caseSep = n === ';' || n === '&';
      lx.pos += caseSep ? (lx.at(2) === '&' ? 3 : 2) : 1;
      this.endList();
      if (caseSep && this.caseDepth > 0) this.inPattern = true;
      return;
    }
    if (c === '|') {
      if (this.inPattern) {
        lx.pos++;
        return;
      }
      if (n === '|') {
        lx.pos += 2;
        this.finishCommand();
        this.pendingPipe = null;
        return;
      }
      lx.pos += n === '&' ? 2 : 1;
      this.finishCommand();
      this.pendingPipe = this.lastIndex;
      return;
    }
    if (n === '&') {
      lx.pos += 2;
      this.finishCommand();
      this.pendingPipe = null;
      return;
    }
    lx.pos++;
    this.finishCommand();
    const out = lx.shared.out;
    for (let i = this.listStart; i < out.length; i++) {
      const cmd = out[i];
      if (cmd) cmd.background = true;
    }
    this.endList();
  }

  private redirect(): void {
    const lx = this.lx;
    const start = lx.pos;
    let fd = '';
    while (lx.at() >= '0' && lx.at() <= '9') {
      fd += lx.at();
      lx.pos++;
    }
    const ahead = lx.src.slice(lx.pos, lx.pos + 3);
    const ops = ['&>>', '&>', '<<<', '<<-', '<<', '<>', '<&', '<', '>>', '>|', '>&', '>'];
    const op = ops.find((o) => ahead.startsWith(o)) ?? '>';
    lx.pos += op.length;
    lx.skipBlanks();
    const c = lx.at();
    const blocked = c === '' || c === '\n' || ';&|()'.includes(c);
    if (blocked || ((c === '<' || c === '>') && lx.at(1) !== '(')) return;
    const target = lx.readWord(this.depth, this.cwd);
    if (op === '<<' || op === '<<-') {
      lx.heredocs.push({ delim: target.value, stripTabs: op === '<<-' });
    }
    if (this.inPattern || this.cmd.header) return;
    this.touch(start);
    this.cmd.redirects.push({ op: fd + op, target });
  }

  private touch(start: number): void {
    if (this.cmd.start === -1) this.cmd.start = start;
    this.cmd.end = this.lx.pos;
  }

  private addWord(word: Word, start: number): void {
    const cmd = this.cmd;
    const reserved = word.quoted ? null : word.value;
    if (this.inPattern) {
      if (reserved === 'esac') {
        this.inPattern = false;
        this.caseDepth = Math.max(0, this.caseDepth - 1);
      }
      return;
    }
    if (cmd.header) {
      if (cmd.caseHeader && reserved === 'in') {
        this.cmd = newBuilder();
        this.inPattern = true;
      }
      return;
    }
    if (cmd.words.length === 0 && cmd.assignments.length === 0) {
      if (this.skipWords > 0) {
        this.skipWords--;
        return;
      }
      if (reserved !== null) {
        if (SKIP_WORDS.has(reserved)) return;
        if (reserved === 'esac') {
          this.caseDepth = Math.max(0, this.caseDepth - 1);
          return;
        }
        if (reserved === 'for' || reserved === 'select') {
          cmd.header = true;
          return;
        }
        if (reserved === 'case') {
          cmd.header = true;
          cmd.caseHeader = true;
          this.caseDepth++;
          return;
        }
        if (reserved === 'function') {
          this.skipWords = 1;
          return;
        }
      }
      if (ASSIGNMENT_RAW.test(word.raw)) {
        this.touch(start);
        cmd.assignments.push(word);
        return;
      }
    }
    this.touch(start);
    cmd.words.push(word);
  }

  private endList(): void {
    this.finishCommand();
    this.pendingPipe = null;
    this.listStart = this.lx.shared.out.length;
  }

  private finishCommand(): void {
    const b = this.cmd;
    this.cmd = newBuilder();
    if (b.header || isEmpty(b)) return;
    const shared = this.lx.shared;
    const parsed: ParsedCommand = {
      words: b.words,
      assignments: b.assignments,
      redirects: b.redirects,
      depth: this.depth,
      background: false,
      pipedFrom: this.pendingPipe,
      cwd: this.cwd,
      text: capText(this.lx.src.slice(b.start, b.end), MAX_COMMAND_TEXT),
    };
    this.pendingPipe = null;
    if (shared.out.length >= MAX_SHELL_COMMANDS) {
      shared.truncated = true;
      this.lastIndex = null;
    } else {
      shared.out.push(parsed);
      this.lastIndex = shared.out.length - 1;
    }
    this.afterCommand(parsed);
  }

  /** Tracks cd and parses sh -c and eval strings. */
  private afterCommand(parsed: ParsedCommand): void {
    const values = parsed.words.map((w) => w.value);
    const u = unwrap(values);
    const programWord = parsed.words[u.index];
    if (!programWord) return;
    const program = programName(programWord.value);
    const args = parsed.words.slice(u.index + 1);
    if (parsed.pipedFrom === null && ['cd', 'pushd', 'popd', 'chdir'].includes(program)) {
      this.changeDirectory(program, args);
    }
    if (this.lx.shared.out.length >= MAX_SHELL_COMMANDS) return;
    if (SHELLS.has(program)) {
      const script = commandString(args);
      if (script?.subst.length === 0) this.parseInner(script.value, parsed.cwd);
    } else if (program === 'eval' && args.length > 0) {
      if (args.every((w) => w.subst.length === 0)) {
        this.parseInner(args.map((w) => w.value).join(' '), parsed.cwd);
      }
    }
  }

  private parseInner(text: string, cwd: string | null): void {
    const shared = this.lx.shared;
    if (this.depth + 1 > MAX_SHELL_DEPTH || text.length > LIMITS.maxCommandParseLength) {
      shared.truncated = true;
      return;
    }
    parseString(text, shared, this.depth + 1, cwd);
  }

  private changeDirectory(program: string, args: Word[]): void {
    if (program === 'popd') {
      this.cwd = this.dirStack.pop() ?? null;
      return;
    }
    let target: Word | null = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (!a) continue;
      if (a.value === '--') {
        target = args[i + 1] ?? null;
        break;
      }
      if (/^-[LPe@n]+$/.test(a.value)) continue;
      target = a;
      break;
    }
    if (program === 'pushd') this.dirStack.push(this.cwd);
    const home = this.lx.shared.home;
    if (target === null) {
      this.cwd = program === 'pushd' ? null : home;
      return;
    }
    if (target.value === '-' || /^[+-]\d+$/.test(target.value)) {
      this.cwd = null;
      return;
    }
    const resolved = resolveWord(target, this.cwd, home);
    this.cwd = resolved && !resolved.unresolved ? resolved.path : null;
  }
}

/** The command string of `sh -c '<string>'`, or null when there is none. */
export function commandString(args: readonly Word[]): Word | null {
  let cFlag = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;
    const v = a.value;
    if (v === '--' || v === '-') break;
    if (v.startsWith('--')) {
      if (v === '--rcfile' || v === '--init-file') i++;
      continue;
    }
    if (v.startsWith('-') || v.startsWith('+')) {
      if (!v.startsWith('+') && v.includes('c')) cFlag = true;
      if (/[oO]$/.test(v)) i++;
      continue;
    }
    return cFlag ? a : null;
  }
  return null;
}

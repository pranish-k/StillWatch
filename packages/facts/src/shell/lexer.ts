/**
 * Shell lexer: reads words with quoting, expansions, and substitutions.
 * Every scan moves forward; nested substitutions recurse through the list
 * parser up to MAX_SHELL_DEPTH and are skipped linearly beyond it.
 */
import type { ParsedCommand, Word } from './types';

/** Deepest nesting of $(...), backticks, <(...), and sh -c strings that is parsed. */
export const MAX_SHELL_DEPTH = 8;

export type Shared = {
  out: ParsedCommand[];
  truncated: boolean;
  home: string;
};

export type Heredoc = { delim: string; stripTabs: boolean };

/** Parses a nested list (a substitution body) from the lexer's current position. */
export type NestedParser = (lexer: Lexer, depth: number, cwd: string | null) => void;
/** Parses a separate source string (backticks, sh -c) as a command list. */
export type StringParser = (src: string, shared: Shared, depth: number, cwd: string | null) => void;

type WordState = {
  value: string;
  dynamic: boolean;
  glob: boolean;
  leadTilde: boolean;
  subst: number[];
  quoted: boolean;
  braceDepth: number;
  braceGlob: boolean;
};

const WORD_END = new Set([' ', '\t', '\n', '\r', ';', '&', '|', ')', '']);
const SPECIAL_PARAMS = '@*#?$!-0123456789';
const ARRAY_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=$/;

function isNameStart(c: string): boolean {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_';
}

function isNameChar(c: string): boolean {
  return isNameStart(c) || (c >= '0' && c <= '9');
}

export class Lexer {
  readonly src: string;
  readonly shared: Shared;
  readonly heredocs: Heredoc[] = [];
  pos = 0;
  private readonly nested: NestedParser;
  private readonly parseString: StringParser;

  constructor(src: string, shared: Shared, nested: NestedParser, parseString: StringParser) {
    this.src = src;
    this.shared = shared;
    this.nested = nested;
    this.parseString = parseString;
  }

  at(offset = 0): string {
    return this.src.charAt(this.pos + offset);
  }

  get done(): boolean {
    return this.pos >= this.src.length;
  }

  skipBlanks(): void {
    for (;;) {
      const c = this.at();
      if (c === ' ' || c === '\t' || c === '\r') this.pos++;
      else if (c === '\\' && this.at(1) === '\n') this.pos += 2;
      else return;
    }
  }

  skipComment(): void {
    const nl = this.src.indexOf('\n', this.pos);
    this.pos = nl === -1 ? this.src.length : nl;
  }

  /** Skips here-document bodies queued on the line that just ended. */
  readHeredocBodies(): void {
    const s = this.src;
    for (const doc of this.heredocs) {
      while (this.pos < s.length) {
        const nl = s.indexOf('\n', this.pos);
        const lineEnd = nl === -1 ? s.length : nl;
        let line = s.slice(this.pos, lineEnd);
        this.pos = nl === -1 ? s.length : nl + 1;
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (doc.stripTabs) line = line.replace(/^\t+/, '');
        if (line === doc.delim) break;
      }
    }
    this.heredocs.length = 0;
  }

  /** Index just past the `)` matching the `(` at `open`. Linear, never recursive. */
  matchParen(open: number): number {
    const s = this.src;
    let depth = 0;
    let i = open;
    while (i < s.length) {
      const c = s.charAt(i);
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === "'") {
        const end = s.indexOf("'", i + 1);
        i = end === -1 ? s.length : end + 1;
        continue;
      }
      if (c === '"') {
        i = skipDoubleQuoted(s, i + 1);
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth <= 0) return i + 1;
      }
      i++;
    }
    return s.length;
  }

  /** Reads one word starting at the current position. */
  readWord(depth: number, cwd: string | null): Word {
    const start = this.pos;
    const w: WordState = {
      value: '',
      dynamic: false,
      glob: false,
      leadTilde: false,
      subst: [],
      quoted: false,
      braceDepth: 0,
      braceGlob: false,
    };
    const s = this.src;
    while (!this.done) {
      const c = this.at();
      if (c === '<' || c === '>') {
        if (this.pos === start && this.at(1) === '(') {
          this.substitution(w, depth, cwd);
          continue;
        }
        break;
      }
      if (WORD_END.has(c)) break;
      if (c === '(') {
        if (!ARRAY_ASSIGNMENT.test(s.slice(start, this.pos))) break;
        const end = this.matchParen(this.pos);
        w.value += s.slice(this.pos, end);
        w.dynamic = true;
        this.pos = end;
        continue;
      }
      switch (c) {
        case '\\': {
          const n = this.at(1);
          this.pos += n === '' ? 1 : 2;
          if (n !== '\n' && n !== '') {
            w.value += n;
            w.quoted = true;
          }
          continue;
        }
        case "'": {
          const end = s.indexOf("'", this.pos + 1);
          const stop = end === -1 ? s.length : end;
          w.value += s.slice(this.pos + 1, stop);
          w.quoted = true;
          this.pos = end === -1 ? s.length : end + 1;
          continue;
        }
        case '"':
          this.pos++;
          w.quoted = true;
          this.readDouble(w, depth, cwd);
          continue;
        case '$':
          this.readDollar(w, depth, cwd, false);
          continue;
        case '`':
          this.readBacktick(w, depth, cwd);
          continue;
        case '*':
        case '?':
        case '[':
          w.glob = true;
          break;
        case '{':
          w.braceDepth++;
          break;
        case '}':
          if (w.braceDepth > 0) w.braceDepth--;
          break;
        case ',':
          if (w.braceDepth > 0) w.braceGlob = true;
          break;
        case '.':
          if (w.braceDepth > 0 && this.at(1) === '.') w.braceGlob = true;
          break;
        case '~':
          if (this.pos === start) {
            const n = this.at(1);
            if (n === '/' || WORD_END.has(n) || n === '<' || n === '>') w.leadTilde = true;
            else w.dynamic = true;
          }
          break;
        default:
          break;
      }
      w.value += c;
      this.pos++;
    }
    return {
      value: w.value,
      raw: s.slice(start, this.pos),
      dynamic: w.dynamic,
      glob: w.glob || w.braceGlob,
      literalTilde: w.value.startsWith('~') && !w.leadTilde,
      subst: w.subst,
      quoted: w.quoted,
    };
  }

  private readDouble(w: WordState, depth: number, cwd: string | null): void {
    while (!this.done) {
      const c = this.at();
      if (c === '"') {
        this.pos++;
        return;
      }
      if (c === '\\') {
        const n = this.at(1);
        if (n === '\n') {
          this.pos += 2;
        } else if (n !== '' && '$`"\\'.includes(n)) {
          w.value += n;
          this.pos += 2;
        } else {
          w.value += '\\';
          this.pos++;
        }
        continue;
      }
      if (c === '$') {
        this.readDollar(w, depth, cwd, true);
        continue;
      }
      if (c === '`') {
        this.readBacktick(w, depth, cwd);
        continue;
      }
      w.value += c;
      this.pos++;
    }
  }

  private readDollar(w: WordState, depth: number, cwd: string | null, inDouble: boolean): void {
    const s = this.src;
    const n = this.at(1);
    if (n === '(') {
      if (this.at(2) === '(') {
        const end = this.matchParen(this.pos + 1);
        w.value += s.slice(this.pos, end);
        w.dynamic = true;
        this.pos = end;
        return;
      }
      this.substitution(w, depth, cwd);
      return;
    }
    if (n === '{') {
      const end = matchBrace(s, this.pos + 1);
      const inner = s.slice(this.pos + 2, end - 1);
      if (inner !== 'HOME') w.dynamic = true;
      w.value += s.slice(this.pos, end);
      this.pos = end;
      return;
    }
    if (!inDouble && n === "'") {
      this.pos += 2;
      w.value += this.readAnsiC();
      w.quoted = true;
      return;
    }
    if (!inDouble && n === '"') {
      this.pos += 2;
      w.quoted = true;
      this.readDouble(w, depth, cwd);
      return;
    }
    if (isNameStart(n)) {
      let e = this.pos + 2;
      while (e < s.length && isNameChar(s.charAt(e))) e++;
      const name = s.slice(this.pos + 1, e);
      if (name !== 'HOME') w.dynamic = true;
      w.value += `$${name}`;
      this.pos = e;
      return;
    }
    if (n !== '' && SPECIAL_PARAMS.includes(n)) {
      w.dynamic = true;
      w.value += `$${n}`;
      this.pos += 2;
      return;
    }
    w.value += '$';
    this.pos++;
  }

  /** `$(...)`, `<(...)`, or `>(...)` at the current position. */
  private substitution(w: WordState, depth: number, cwd: string | null): void {
    const start = this.pos;
    if (depth + 1 > MAX_SHELL_DEPTH) {
      this.shared.truncated = true;
      this.pos = this.matchParen(this.pos + 1);
    } else {
      this.pos += 2;
      const before = this.shared.out.length;
      this.nested(this, depth + 1, cwd);
      for (let i = before; i < this.shared.out.length; i++) w.subst.push(i);
    }
    w.value += this.src.slice(start, this.pos);
    w.dynamic = true;
  }

  private readBacktick(w: WordState, depth: number, cwd: string | null): void {
    const s = this.src;
    const start = this.pos;
    let i = start + 1;
    while (i < s.length) {
      const c = s.charAt(i);
      if (c === '\\') i += 2;
      else if (c === '`') break;
      else i++;
    }
    const inner = s.slice(start + 1, Math.min(i, s.length)).replace(/\\([`\\$])/g, '$1');
    this.pos = Math.min(i + 1, s.length);
    if (depth + 1 > MAX_SHELL_DEPTH) {
      this.shared.truncated = true;
    } else {
      const before = this.shared.out.length;
      this.parseString(inner, this.shared, depth + 1, cwd);
      for (let k = before; k < this.shared.out.length; k++) w.subst.push(k);
    }
    w.value += s.slice(start, this.pos);
    w.dynamic = true;
  }

  /** Decodes a `$'...'` string; the position is just after `$'`. */
  private readAnsiC(): string {
    const s = this.src;
    let out = '';
    while (!this.done) {
      const c = this.at();
      if (c === "'") {
        this.pos++;
        return out;
      }
      if (c !== '\\') {
        out += c;
        this.pos++;
        continue;
      }
      const n = this.at(1);
      this.pos += 2;
      switch (n) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case 'r':
          out += '\r';
          break;
        case 'a':
          out += '\x07';
          break;
        case 'b':
          out += '\b';
          break;
        case 'e':
        case 'E':
          out += '\x1b';
          break;
        case 'f':
          out += '\f';
          break;
        case 'v':
          out += '\v';
          break;
        case 'x': {
          const m = /^[0-9A-Fa-f]{1,2}/.exec(s.slice(this.pos, this.pos + 2));
          if (m) {
            out += String.fromCharCode(parseInt(m[0], 16));
            this.pos += m[0].length;
          } else {
            out += '\\x';
          }
          break;
        }
        case 'u':
        case 'U': {
          const max = n === 'u' ? 4 : 8;
          const m = /^[0-9A-Fa-f]+/.exec(s.slice(this.pos, this.pos + max));
          const cp = m ? parseInt(m[0], 16) : NaN;
          if (m && cp <= 0x10ffff) {
            out += String.fromCodePoint(cp);
            this.pos += m[0].length;
          } else {
            out += `\\${n}`;
          }
          break;
        }
        default: {
          if (n >= '0' && n <= '7') {
            const m = /^[0-7]{1,3}/.exec(s.slice(this.pos - 1, this.pos + 2));
            const digits = m ? m[0] : n;
            out += String.fromCharCode(parseInt(digits, 8) & 0xff);
            this.pos += digits.length - 1;
          } else {
            out += n;
          }
        }
      }
    }
    return out;
  }
}

/** Index just past the closing double quote, starting after the opening one. */
function skipDoubleQuoted(s: string, from: number): number {
  let i = from;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === '\\') i += 2;
    else if (c === '"') return i + 1;
    else i++;
  }
  return s.length;
}

/** Index just past the `}` matching the `{` at `open`. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === '\\') i++;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return s.length;
}

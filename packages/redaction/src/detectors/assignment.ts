/**
 * Values assigned to secret-named keys:
 * `KEY=value`, `KEY: value`, `"key": "value"`, `key => 'value'`,
 * `--key=value`, and `--key value`.
 *
 * The scan looks for secret words with one regex of plain alternatives, then
 * widens each hit to the surrounding key name and parses what follows by
 * hand. Every character is visited a bounded number of times: the name is
 * widened only back to the end of the previous name, the scan resumes after
 * the consumed value, and closing quotes are found with `NextIndex`.
 */
import { isPlaceholderValue, isProse, isSecretName } from '../secret-names';
import { isBlankCode, isNameCode, isWhitespaceCode, NextIndex } from '../text';
import type { Span, StringDetector } from './types';

const SECRET_WORD =
  /pass|pwd|secret|token|api[_.-]?key|access[_.-]?key|private[_.-]?key|auth|credential|cookie|session[_.-]?key|signature/gi;
const MAX_QUOTED = 4096;
const MIN_VALUE = 6;
const DOTTED_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/;
const WORDLIKE = /^[A-Za-z_.$-]+$/;
const LETTERS = /^[A-Za-z]+$/;
/** An environment variable name as env files write it: upper case, digits, and underscores. */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const COOKIE_NAME = /cookie/i;

type Parsed = { span: Span | null; resume: number };

/** Characters that end an unquoted value. */
function endsUnquoted(code: number, cookie: boolean): boolean {
  if (code === 10 || code === 13) return true;
  if (isWhitespaceCode(code)) return !cookie;
  switch (code) {
    case 34: // "
    case 39: // '
    case 96: // `
    case 92: // backslash
    case 60: // <
    case 62: // >
    case 40: // (
    case 41: // )
    case 123: // {
    case 125: // }
    case 91: // [
    case 93: // ]
    case 124: // |
    case 44: // ,
      return true;
    case 59: // ;
    case 38: // &
      return !cookie;
    default:
      return false;
  }
}

class AssignmentScanner {
  private readonly quotes = new Map<string, NextIndex>();
  private readonly newline: NextIndex;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
    this.newline = new NextIndex(text, '\n');
  }

  private nextQuote(quote: string, from: number): number {
    let index = this.quotes.get(quote);
    if (!index) {
      index = new NextIndex(this.text, quote);
      this.quotes.set(quote, index);
    }
    return index.find(from);
  }

  scan(): Span[] {
    const { text } = this;
    const spans: Span[] = [];
    const words = new RegExp(SECRET_WORD.source, 'gi');
    let floor = 0;
    let match: RegExpExecArray | null;
    while ((match = words.exec(text)) !== null) {
      let start = match.index;
      while (start > floor && isNameCode(text.charCodeAt(start - 1))) start--;
      let end = match.index + match[0].length;
      while (end < text.length && isNameCode(text.charCodeAt(end))) end++;
      const parsed = this.parse(start, end);
      if (parsed.span) spans.push(parsed.span);
      floor = Math.max(end, parsed.resume);
      words.lastIndex = floor;
    }
    return spans;
  }

  /** Parses `name sep value` where the name occupies [start, end). */
  private parse(start: number, end: number): Parsed {
    const { text } = this;
    const none: Parsed = { span: null, resume: end };
    let nameStart = start;
    let dashes = 0;
    while (nameStart < end && text.charCodeAt(nameStart) === 45) {
      nameStart++;
      dashes++;
    }
    let nameEnd = end;
    while (nameEnd > nameStart && text.charCodeAt(nameEnd - 1) === 46) nameEnd--;
    if (nameEnd !== end) return none;
    const name = text.slice(nameStart, nameEnd);
    const flag = dashes > 0 && dashes <= 2;
    if (!isSecretName(name)) return none;
    if (/^(?:old)?pwd$/i.test(name)) return none;

    let p = end;
    const before = start > 0 ? text.charAt(start - 1) : '';
    // A quoted key: "key": or 'key': and JSON escaped inside a string: \"key\":
    if ((before === '"' || before === "'") && text.charAt(p) === before) {
      p++;
    } else if (before === '"' && text.startsWith('\\"', p)) {
      p += 2;
    }
    const sepStart = p;
    while (p - sepStart < 4 && isBlankCode(text.charCodeAt(p))) p++;
    const blanksBefore = p - sepStart;
    const sep = text.charAt(p);
    if (sep === '=') {
      const after = text.charAt(p + 1);
      if (after === '=' || after === '~') return none;
      p += after === '>' ? 2 : 1;
    } else if (sep === ':') {
      const after = text.charAt(p + 1);
      if (after === ':' || after === '/' || after === '=') return none;
      p += 1;
    } else if (!(flag && blanksBefore > 0 && sep !== '-' && sep !== '')) {
      return none;
    }
    // `NAME=value` with an upper-case env name and no blanks is env-file syntax, where a bare
    // word is data, not a code identifier, so a letters-only password still counts.
    const envFile =
      sep === '=' &&
      blanksBefore === 0 &&
      !flag &&
      ENV_NAME.test(name) &&
      !isBlankCode(text.charCodeAt(p));
    const valueStart = p;
    while (p - valueStart < 8 && isBlankCode(text.charCodeAt(p))) p++;
    return this.parseValue(p, COOKIE_NAME.test(name), envFile);
  }

  private parseValue(p: number, cookie: boolean, envFile = false): Parsed {
    const { text } = this;
    let quote = text.charAt(p);
    let open = p + 1;
    if (quote === '\\' && text.charAt(p + 1) === '"') {
      quote = '"';
      open = p + 2;
    }
    if (quote === '"' || quote === "'" || quote === '`') {
      const close = this.nextQuote(quote, open);
      const newline = this.newline.find(open);
      if (close === -1 || (newline !== -1 && newline < close) || close - open > MAX_QUOTED) {
        return { span: null, resume: open };
      }
      let valueEnd = close;
      if (text.charCodeAt(close - 1) === 92) valueEnd--;
      const value = text.slice(open, valueEnd);
      const ok = !isPlaceholderValue(value, { minLength: MIN_VALUE }) && !isProse(value);
      return { span: ok ? { start: open, end: valueEnd } : null, resume: close + 1 };
    }
    let end = p;
    while (end < text.length && !endsUnquoted(text.charCodeAt(end), cookie)) end++;
    const resume = end;
    while (end > p && isTrailingPunctuation(text.charCodeAt(end - 1))) end--;
    if (cookie) while (end > p && isWhitespaceCode(text.charCodeAt(end - 1))) end--;
    const value = text.slice(p, end);
    if (!acceptUnquoted(value, text.charAt(resume), envFile)) return { span: null, resume };
    return { span: { start: p, end }, resume };
  }
}

function isTrailingPunctuation(code: number): boolean {
  return code === 46 || code === 58 || code === 59 || code === 33 || code === 63;
}

/**
 * Unquoted values are often code (`token = getToken()`, `secret: config.key`)
 * or prose (`auth: the system`), so only values that look like data count.
 */
function acceptUnquoted(value: string, next: string, envFile: boolean): boolean {
  if (isPlaceholderValue(value, { minLength: MIN_VALUE })) return false;
  if (next === '(') return false;
  if ((WORDLIKE.test(value) && !(envFile && LETTERS.test(value))) || DOTTED_IDENTIFIER.test(value))
    return false;
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return false;
  if (value.startsWith('~/') || value.includes('://')) return false;
  return true;
}

/** Values of secret-named keys in env, YAML, JSON, and CLI flag syntax. */
export const envAssignment: StringDetector = {
  info: {
    id: 'env-assignment',
    description: 'Value assigned to a secret-named key (KEY=value, key: value, --key value)',
    kind: 'assignment',
  },
  applies: (_text, lower) =>
    lower.includes('pass') ||
    lower.includes('pwd') ||
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('key') ||
    lower.includes('auth') ||
    lower.includes('credential') ||
    lower.includes('cookie') ||
    lower.includes('signature'),
  find: (text) => new AssignmentScanner(text).scan(),
};

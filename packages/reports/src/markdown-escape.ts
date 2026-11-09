/**
 * Markdown escaping for untrusted text.
 *
 * Strategy (works for CommonMark, GFM, and common extensions):
 * - Characters that are special anywhere are always backslash-escaped:
 *   \ ` * _ [ ] < > | ~ & { } # $
 * - Characters that only matter at the start of a line or list item
 *   (- + = and ordered-list markers such as "1." or "1)") are escaped there.
 *   Every escaped field is treated as if it starts a line, so it is safe
 *   wherever it is placed.
 * - Text that renderers turn into links or notifications on their own
 *   (scheme URLs, www. hosts, emails, @mentions, #123 references) is put
 *   in inline code, which no renderer links.
 * - Paths, commands, and domains are inline code with a backtick fence longer
 *   than any backtick run inside. Multi-line text is a fenced code block.
 * Input is sanitized (escape sequences and controls removed, invisible
 * characters made visible) and capped first, so regex work stays bounded.
 */
import { clip, multiLine, oneLine } from './text';

const ALWAYS = /[\\`*_[\]<>|~&{}#$]/g;

const LINKISH = new RegExp(
  [
    String.raw`\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s<>\x60]*`,
    String.raw`\b(?:https?|ftp|file|mailto|xmpp|javascript|data|vbscript):[^\s<>\x60]*`,
    String.raw`\bwww\.[^\s<>\x60]*`,
    String.raw`[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,8}`,
    String.raw`(?<![a-z0-9_\x60])@[a-z0-9][a-z0-9-]{0,38}`,
    String.raw`(?<![a-z0-9_&])#\d{1,10}\b`,
  ].join('|'),
  'gi',
);

function escapeInline(text: string): string {
  return text.replace(ALWAYS, '\\$&');
}

function escapeLeading(text: string): string {
  if (/^[-+=]/.test(text)) return `\\${text}`;
  const ordered = /^(\d{1,9})([.)])/.exec(text);
  if (ordered) {
    const [whole, digits, marker] = ordered;
    return `${digits ?? ''}\\${marker ?? ''}${text.slice(whole.length)}`;
  }
  return text;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0x60) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return longest;
}

/** Inline code span for already-sanitized single-line text. */
function codeSpan(text: string): string {
  const fence = '`'.repeat(longestBacktickRun(text) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Untrusted single-line text, safe in any Markdown text position. */
export function mdText(text: string, max = 300): string {
  const s = clip(oneLine(text), max);
  let out = '';
  let last = 0;
  for (const match of s.matchAll(LINKISH)) {
    out += escapeInline(s.slice(last, match.index));
    out += codeSpan(match[0]);
    last = match.index + match[0].length;
  }
  out += escapeInline(s.slice(last));
  return escapeLeading(out);
}

/** Untrusted single-line text as an inline code span. Empty input gives "(empty)". */
export function mdCode(text: string, max = 300): string {
  const s = clip(oneLine(text), max);
  return s === '' ? '(empty)' : codeSpan(s);
}

/** Untrusted multi-line text as a fenced code block that its content cannot close. */
export function mdFence(text: string, max = 4_000, info = 'text'): string {
  const s = clip(multiLine(text), max);
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(s) + 1));
  return `${fence}${info}\n${s}\n${fence}`;
}

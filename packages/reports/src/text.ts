/**
 * Plain-text hygiene for untrusted strings (titles, prompts, paths, messages).
 *
 * Session data can carry terminal escape sequences, control characters, and
 * invisible Unicode (bidirectional overrides, zero-width spaces, Unicode tag
 * characters) that hide or reorder what a reader sees. These helpers remove
 * the escapes and controls and make invisible characters visible as
 * `[U+XXXX]`, so every renderer (dashboard or Markdown) shows the truth.
 * All functions are pure, linear time, and idempotent.
 */

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

/** Terminal control sequences: CSI (`ESC [ ... final`). */
const ANSI_CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
/** OSC sequences (`ESC ] ... BEL` or `ESC ] ... ESC \`), possibly unterminated. */
const ANSI_OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)?`, 'g');
/** Two-character escape sequences (`ESC` followed by one byte). */
const ANSI_SHORT = new RegExp(`${ESC}[@-Z\\\\-_]`, 'g');

/**
 * Invisible characters that can hide or reorder text: Arabic letter mark,
 * zero-width space, directional marks, bidirectional embeddings, overrides,
 * and isolates, word joiner and invisible operators, byte order mark, and
 * Unicode tag characters. Zero-width joiner and non-joiner are kept because
 * emoji and several scripts need them.
 */
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x061c, 0x061c],
  [0x200b, 0x200b],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
];

const ELLIPSIS = String.fromCharCode(0x2026);

function isInvisible(code: number): boolean {
  for (const [low, high] of INVISIBLE_RANGES) {
    if (code >= low && code <= high) return true;
  }
  return false;
}

/** C0 controls except tab and newline, DEL, and C1 controls. */
function isControl(code: number): boolean {
  return (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
}

function cleanCodePoints(text: string): string {
  let out = '';
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const code = text.codePointAt(i) ?? 0;
    const width = code > 0xffff ? 2 : 1;
    if (isControl(code) || isInvisible(code)) {
      out += text.slice(start, i);
      if (isInvisible(code)) out += `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]`;
      start = i + width;
    }
    i += width;
  }
  return start === 0 ? text : out + text.slice(start);
}

/**
 * Removes terminal escape sequences and control characters and makes
 * invisible characters visible. Newlines become `\n`; tabs are kept.
 */
export function sanitizeMultiline(text: string): string {
  const stripped = text
    .toWellFormed()
    .replace(ANSI_OSC, '')
    .replace(ANSI_CSI, '')
    .replace(ANSI_SHORT, '')
    .replace(/\r\n?/g, '\n');
  return cleanCodePoints(stripped);
}

/** `sanitizeMultiline`, then collapses all whitespace (including newlines) to single spaces and trims. */
export function oneLine(text: string): string {
  return sanitizeMultiline(text).replace(/\s+/g, ' ').trim();
}

/**
 * Multi-line text for display: sanitized, trailing spaces removed from each
 * line, runs of more than one blank line collapsed, and outer blank lines trimmed.
 */
export function multiLine(text: string): string {
  return sanitizeMultiline(text)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

/**
 * Caps `text` at `max` UTF-16 units, ending with an ellipsis when cut. It
 * never splits a surrogate pair and backs off rather than end inside a short
 * bracketed token such as `[U+202E]` or a redaction marker.
 */
export function clip(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  let cut = max - 1;
  const last = text.charCodeAt(cut - 1);
  if (cut > 0 && last >= 0xd800 && last <= 0xdbff) cut -= 1;
  const open = text.lastIndexOf('[', cut - 1);
  if (open !== -1 && cut - open <= 48) {
    const close = text.indexOf(']', open);
    if (close === -1 || close >= cut) cut = open;
  }
  return `${text.slice(0, cut).trimEnd()}${ELLIPSIS}`;
}

/** `oneLine` then `clip`: the standard treatment for an untrusted single-line field. */
export function cleanLine(text: string, max: number): string {
  return clip(oneLine(text), max);
}

/** Removes trailing sentence punctuation so a phrase can be embedded in a sentence. */
export function stripTrailingPeriod(text: string): string {
  return text.replace(/[.\s]+$/, '');
}

/** First non-empty line of `text`, cleaned and capped. */
export function firstLine(text: string, max: number): string {
  for (const line of sanitizeMultiline(text).split('\n')) {
    const cleaned = line.replace(/\s+/g, ' ').trim();
    if (cleaned !== '') return clip(cleaned, max);
  }
  return '';
}

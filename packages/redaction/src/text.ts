/**
 * Small character helpers shared by the detectors and the truncation code.
 * Everything here works on UTF-16 code units and runs in linear time.
 */

/** True for A-Z, a-z, 0-9. */
export function isAlnumCode(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** True for characters that can appear in a key name: A-Z a-z 0-9 _ . - */
export function isNameCode(code: number): boolean {
  return isAlnumCode(code) || code === 95 || code === 46 || code === 45;
}

/** True for a space or a tab. */
export function isBlankCode(code: number): boolean {
  return code === 32 || code === 9;
}

/** True for any ASCII whitespace. */
export function isWhitespaceCode(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13);
}

/** True when the code unit is a UTF-16 high (leading) surrogate. */
export function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Returns an index at most `end` that does not split a surrogate pair, so
 * `text.slice(0, result)` is always well formed.
 */
export function safeCutIndex(text: string, end: number): number {
  if (end <= 0) return 0;
  if (end >= text.length) return text.length;
  return isHighSurrogate(text.charCodeAt(end - 1)) ? end - 1 : end;
}

/**
 * Finds the next occurrence of one character, for queries whose start index
 * never decreases. Each region of the text is scanned at most once, so a
 * sequence of queries runs in linear time overall.
 */
export class NextIndex {
  private from = -1;
  private at = -1;

  private readonly text: string;
  private readonly char: string;

  constructor(text: string, char: string) {
    this.text = text;
    this.char = char;
  }

  /** Index of the next occurrence at or after `from`, or -1. */
  find(from: number): number {
    if (this.from !== -1 && from >= this.from && (this.at === -1 || from <= this.at)) {
      return this.at;
    }
    this.from = from;
    this.at = this.text.indexOf(this.char, from);
    return this.at;
  }
}

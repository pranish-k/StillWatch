/** Helpers for NUL-separated (`-z`) git output and line-based git input. */

/**
 * Splits NUL-terminated output into fields. When `complete` is false (output was
 * cut off), the trailing partial field is dropped.
 */
export function splitNul(output: Buffer, complete = true): string[] {
  const text = output.toString('utf8');
  const fields = text.split('\0');
  // The last element is empty after a final NUL, or a partial field after a cut.
  const last = fields.pop();
  if (complete && last !== undefined && last !== '') fields.push(last);
  return fields;
}

/** Splits newline-terminated output into lines, without the final empty line. */
export function splitLines(output: Buffer): string[] {
  const lines = output.toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * Quotes a path the way git's `unquote_c_style` reads it, for line-based stdin
 * such as `hash-object --stdin-paths`. Paths that need no quoting are returned as is.
 */
export function quoteForStdinPath(path: string): string {
  if (!path.startsWith('"') && !path.includes('\n')) return path;
  let quoted = '"';
  for (const char of path) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '"' || char === '\\') quoted += `\\${char}`;
    else if (char === '\n') quoted += '\\n';
    else if (char === '\t') quoted += '\\t';
    else if (code < 0x20 || code === 0x7f) quoted += `\\${code.toString(8).padStart(3, '0')}`;
    else quoted += char;
  }
  return `${quoted}"`;
}

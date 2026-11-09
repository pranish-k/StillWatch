import { displayPath } from '@stillwatch/schema';
import type { CliDeps } from './deps';

export type Style = {
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
};

function sgr(open: number, close: number): (text: string) => string {
  return (text) => `\u001b[${open}m${text}\u001b[${close}m`;
}

const plain = (text: string): string => text;

export function makeStyle(enabled: boolean): Style {
  if (!enabled) {
    return { bold: plain, dim: plain, red: plain, green: plain, yellow: plain, cyan: plain };
  }
  return {
    bold: sgr(1, 22),
    dim: sgr(2, 22),
    red: sgr(31, 39),
    green: sgr(32, 39),
    yellow: sgr(33, 39),
    cyan: sgr(36, 39),
  };
}

/** Command context: injected deps plus output helpers. */
export type Ctx = {
  deps: CliDeps;
  /** Style for stdout (colors only on a TTY without NO_COLOR). */
  s: Style;
  color: boolean;
  out(line?: string): void;
  err(line: string): void;
  warn(line: string): void;
  /** Path for display, with `~` for the home directory. */
  path(p: string): string;
};

export function createContext(deps: CliDeps): Ctx {
  const noColor = deps.env.NO_COLOR !== undefined && deps.env.NO_COLOR !== '';
  const color = deps.stdout.isTTY && !noColor;
  const errStyle = makeStyle(deps.stderr.isTTY && !noColor);
  return {
    deps,
    s: makeStyle(color),
    color,
    out: (line = '') => {
      deps.stdout.write(`${line}\n`);
    },
    err: (line) => {
      deps.stderr.write(`${line}\n`);
    },
    warn: (line) => {
      deps.stderr.write(`${errStyle.yellow('warning:')} ${line}\n`);
    },
    path: (p) => displayPath(p, null, deps.home),
  };
}

/**
 * Makes untrusted text safe for a terminal: control characters (including
 * escape sequences) become "?", and line breaks become spaces.
 */
export function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');
}

/** Like `clean` but keeps line breaks and tabs (for multi-line documents). */
export function cleanDocument(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '?');
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

/**
 * Aligned text table. `paint` colors a cell after padding, so colors do not
 * break alignment. The last column is not padded.
 */
export function table(
  header: string[],
  rows: string[][],
  paint?: (column: number, value: string, padded: string) => string,
): string {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? '').length)),
  );
  const line = (cells: string[], isHeader: boolean): string =>
    cells
      .map((cell, i) => {
        const padded = i === cells.length - 1 ? cell : cell.padEnd(widths[i] ?? 0);
        return !isHeader && paint ? paint(i, cell, padded) : padded;
      })
      .join('  ')
      .trimEnd();
  return [line(header, true), ...rows.map((row) => line(row, false))].join('\n');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? 'TB'}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatAgo(ts: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Local date and time, "2026-11-05 14:03". */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${formatCount(n)} ${n === 1 ? word : many}`;
}

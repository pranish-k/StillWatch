/** Claude Code version helpers. */

const VERSION_PATTERN = /(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]{1,64}))?/;

/** Extracts "2.1.318" from `claude --version` output such as "2.1.318 (Claude Code)". */
export function parseClaudeVersion(output: string): string | null {
  const match = VERSION_PATTERN.exec(output.slice(0, 4096));
  return match ? match[0] : null;
}

type ParsedVersion = { core: number[]; pre: string[] | null };

function parseVersion(input: string): ParsedVersion {
  let text = input.trim();
  if (text.startsWith('v') || text.startsWith('V')) text = text.slice(1);
  const plus = text.indexOf('+');
  if (plus !== -1) text = text.slice(0, plus);
  const dash = text.indexOf('-');
  const coreText = dash === -1 ? text : text.slice(0, dash);
  const preText = dash === -1 ? null : text.slice(dash + 1);
  const core = coreText.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return { core, pre: preText === null || preText === '' ? null : preText.split('.') };
}

function comparePre(a: string[], b: string[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return Math.sign(diff);
    } else if (xNum) {
      return -1;
    } else if (yNum) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Numeric dotted-version comparison: negative, zero, or positive. Pre-release suffixes sort before the release. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  const length = Math.max(x.core.length, y.core.length);
  for (let i = 0; i < length; i++) {
    const diff = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (x.pre === null && y.pre === null) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return comparePre(x.pre, y.pre);
}

/**
 * Local version helpers. They mirror `parseClaudeVersion` and
 * `compareVersions` from @stillwatch/adapter-claude, so the installer does not
 * depend on those implementations being present.
 */

const VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;

/** Extracts "2.1.318" from output such as "2.1.318 (Claude Code)". */
export function parseVersionOutput(output: string): string | null {
  const match = VERSION_PATTERN.exec(output);
  return match ? match[0] : null;
}

/** Numeric dotted-version comparison. A pre-release sorts before its release. */
export function compareVersionStrings(a: string, b: string): number {
  const [aCore, aPre] = splitPre(a);
  const [bCore, bPre] = splitPre(b);
  const aParts = aCore.split('.').map(toNumber);
  const bParts = bCore.split('.').map(toNumber);
  const length = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < length; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (aPre === bPre) return 0;
  if (aPre === null) return 1;
  if (bPre === null) return -1;
  return aPre < bPre ? -1 : 1;
}

function splitPre(version: string): [string, string | null] {
  const i = version.indexOf('-');
  return i === -1 ? [version, null] : [version.slice(0, i), version.slice(i + 1)];
}

function toNumber(part: string): number {
  const n = Number.parseInt(part, 10);
  return Number.isFinite(n) ? n : 0;
}

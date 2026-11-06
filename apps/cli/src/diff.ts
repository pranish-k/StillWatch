/** Minimal unified line diff for `install --dry-run`. */

type Op = { kind: ' ' | '-' | '+'; line: string };

const MAX_CELLS = 25_000_000;

function diffOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    return [
      ...a.map((line): Op => ({ kind: '-', line })),
      ...b.map((line): Op => ({ kind: '+', line })),
    ];
  }
  // lcs[i][j] = LCS length of a[i:] and b[j:], stored row-major.
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', line: a[i] ?? '' });
      i++;
      j++;
    } else if ((lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0)) {
      ops.push({ kind: '-', line: a[i] ?? '' });
      i++;
    } else {
      ops.push({ kind: '+', line: b[j] ?? '' });
      j++;
    }
  }
  for (; i < n; i++) ops.push({ kind: '-', line: a[i] ?? '' });
  for (; j < m; j++) ops.push({ kind: '+', line: b[j] ?? '' });
  return ops;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Unified diff lines (without file headers), with `context` unchanged lines
 * around each change. Returns an empty array when the texts are equal.
 */
export function unifiedDiff(before: string, after: string, context = 3): string[] {
  const ops = diffOps(splitLines(before), splitLines(after));
  const changed = ops.map((op) => op.kind !== ' ');
  if (!changed.includes(true)) return [];
  const keep = ops.map((_, index) => {
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k++) {
      if (changed[k]) return true;
    }
    return false;
  });
  const out: string[] = [];
  let skipped = false;
  ops.forEach((op, index) => {
    if (!keep[index]) {
      skipped = true;
      return;
    }
    if (skipped && out.length > 0) out.push('@@');
    skipped = false;
    out.push(`${op.kind}${op.line}`);
  });
  return out;
}

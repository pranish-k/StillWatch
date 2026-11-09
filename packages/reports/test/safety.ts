/**
 * Test helper: checks that rendered Markdown cannot carry injected structure.
 * It removes fenced blocks and inline code spans (which are inert), then
 * looks for any unescaped special character or link-like text that remains.
 */

function stripFences(md: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of md.split('\n')) {
    if (fence === null) {
      const open = /^(`{3,})/.exec(line);
      if (open) {
        fence = open[1] ?? '```';
        continue;
      }
      out.push(line);
    } else if (line.startsWith(fence) && line.slice(fence.length).trim() === '') {
      fence = null;
    }
  }
  if (fence !== null) throw new Error('unterminated fence');
  return out.join('\n');
}

function stripCodeSpans(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line.charAt(i);
    if (ch === '\\') {
      out += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch !== '`') {
      out += ch;
      i += 1;
      continue;
    }
    let n = 0;
    while (line.charAt(i + n) === '`') n++;
    const fence = '`'.repeat(n);
    let j = i + n;
    let close = -1;
    while (j < line.length) {
      const at = line.indexOf(fence, j);
      if (at === -1) break;
      let m = 0;
      while (line.charAt(at + m) === '`') m++;
      if (m === n) {
        close = at;
        break;
      }
      j = at + m;
    }
    if (close === -1) throw new Error(`unclosed code span in: ${line}`);
    out += '<code>';
    i = close + n;
  }
  return out.replace(/<code>/g, 'CODE');
}

const SPECIAL = new Set(['`', '*', '_', '[', ']', '<', '>', '|', '~', '&', '{', '}', '#', '$']);

/** Returns a list of problems; empty means the Markdown is inert. */
export function markdownProblems(md: string): string[] {
  const problems: string[] = [];
  for (const raw of stripFences(md).split('\n')) {
    const line = stripCodeSpans(raw);
    const isHeading = /^#{1,2} /.test(line);
    const body = line
      .replace(/^#{1,2} /, '')
      .replace(/^ {0,2}- /, '')
      .replace(/^ {2}/, '');
    if (!isHeading && line.startsWith('#')) problems.push(`heading marker: ${raw}`);
    if (/^[-+=>]|^\d+[.)]/.test(body)) problems.push(`leading block marker: ${raw}`);
    for (let i = 0; i < body.length; i++) {
      const ch = body.charAt(i);
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (SPECIAL.has(ch)) problems.push(`unescaped ${ch}: ${raw}`);
    }
    if (/https?:|www\.|@[a-z]/i.test(body)) problems.push(`link-like text: ${raw}`);
  }
  return problems;
}

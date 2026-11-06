/**
 * URL and remote-host extraction. All scans are linear: scheme URLs are
 * found with a constant-width pattern and extended by a character loop, and
 * scp-style references are tested per token with an anchored pattern.
 */

const SCHEME_RE = /\b(?:https?|ftps?|sftp|ssh|git(?:\+(?:ssh|https?))?):\/\//gi;
const URL_STOP = new Set([
  ' ',
  '\t',
  '\n',
  '\r',
  '"',
  "'",
  '`',
  '<',
  '>',
  '\\',
  '{',
  '}',
  '|',
  '^',
]);
const TOKEN_STOP = new Set([...URL_STOP, '(', ')', ';', '&', '=', ',']);
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', "'", '"']);
const SCP_RE =
  /^(?:([A-Za-z0-9._-]{1,64})@)?((?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z][A-Za-z0-9-]*|[A-Za-z0-9-]{1,63}|\[[0-9A-Fa-f:.]{2,45}\]):([^\s]*)$/;
const HOST_RE = /^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u;
const IPV6_RE = /^\[[0-9a-f:.]{2,45}\]$/;

/** Most URLs returned for one text. */
export const MAX_URLS = 100;
const MAX_URL_LENGTH = 2048;

function trimUrl(url: string): string {
  let out = url;
  for (;;) {
    const last = out.charAt(out.length - 1);
    if (TRAILING.has(last)) {
      out = out.slice(0, -1);
      continue;
    }
    if (last === ')' || last === ']') {
      const open = last === ')' ? '(' : '[';
      if (count(out, open) < count(out, last)) {
        out = out.slice(0, -1);
        continue;
      }
    }
    return out;
  }
}

function count(s: string, ch: string): number {
  let n = 0;
  for (let i = s.indexOf(ch); i !== -1; i = s.indexOf(ch, i + 1)) n++;
  return n;
}

/** True for an scp-style `[user@]host:path` reference that is clearly remote. */
function isScpReference(token: string): boolean {
  if (token.length > MAX_URL_LENGTH || token.includes('://')) return false;
  const m = SCP_RE.exec(token);
  if (!m) return false;
  const user = m[1];
  const host = m[2] ?? '';
  const path = m[3] ?? '';
  if (/^\d+$/.test(host)) return false;
  if (user !== undefined) return !path.startsWith(':') && !/^\d+$/.test(path);
  const dotted = host.includes('.') || host.startsWith('[');
  return dotted && (path.startsWith('/') || path.startsWith('~'));
}

export function extractUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (url: string): void => {
    if (out.length >= MAX_URLS || seen.has(url) || hostnameOf(url) === null) return;
    seen.add(url);
    out.push(url);
  };
  const covered: [number, number][] = [];
  SCHEME_RE.lastIndex = 0;
  for (let m = SCHEME_RE.exec(text); m !== null; m = SCHEME_RE.exec(text)) {
    let end = m.index + m[0].length;
    while (end < text.length && !URL_STOP.has(text.charAt(end))) end++;
    covered.push([m.index, end]);
    SCHEME_RE.lastIndex = end;
    if (end - m.index <= MAX_URL_LENGTH) push(trimUrl(text.slice(m.index, end)));
  }
  let start = -1;
  let ci = 0;
  for (let i = 0; i <= text.length; i++) {
    const c = i < text.length ? text.charAt(i) : ' ';
    if (!TOKEN_STOP.has(c)) {
      if (start === -1) start = i;
      continue;
    }
    if (start !== -1) {
      while (ci < covered.length && (covered[ci]?.[1] ?? 0) <= start) ci++;
      const range = covered[ci];
      const insideUrl = range !== undefined && range[0] < i;
      const token = trimUrl(text.slice(start, i));
      if (!insideUrl && token.includes(':') && isScpReference(token)) push(token);
      start = -1;
    }
  }
  return out;
}

export function hostnameOf(url: string): string | null {
  const s = url.trim();
  if (s.length > MAX_URL_LENGTH * 2) return null;
  let host: string;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]{0,20}):\/\//.exec(s);
  if (scheme) {
    if ((scheme[1] ?? '').toLowerCase() === 'file') return null;
    const rest = s.slice(scheme[0].length);
    const stop = rest.search(/[/?#]/);
    let authority = stop === -1 ? rest : rest.slice(0, stop);
    authority = authority.slice(authority.lastIndexOf('@') + 1);
    host = stripPort(authority);
  } else {
    if (!isScpReference(s)) return null;
    const m = SCP_RE.exec(s);
    host = m?.[2] ?? '';
  }
  host = host.toLowerCase().replace(/\.$/, '');
  if (host === '') return null;
  if (host.startsWith('[')) return IPV6_RE.test(host) ? host : null;
  return HOST_RE.test(host) ? host : null;
}

function stripPort(authority: string): string {
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    return end === -1 ? '' : authority.slice(0, end + 1);
  }
  const colon = authority.indexOf(':');
  return colon === -1 ? authority : authority.slice(0, colon);
}

/**
 * Host of an ssh, scp, sftp, or rsync destination such as `user@host`,
 * `host:path`, `user@host:path`, `host::module`, or `ssh://host:22`.
 */
export function hostOfDestination(dest: string): string | null {
  if (dest.includes('://')) return hostnameOf(dest);
  let d = dest.slice(dest.lastIndexOf('@') + 1);
  if (d.startsWith('[')) {
    const end = d.indexOf(']');
    d = end === -1 ? '' : d.slice(0, end + 1);
  } else {
    const colon = d.indexOf(':');
    if (colon !== -1) d = d.slice(0, colon);
  }
  if (d === '' || d.includes('/')) return null;
  return hostnameOf(`ssh://${d}`);
}

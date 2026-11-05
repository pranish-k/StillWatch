/**
 * Pure POSIX path helpers. They run in Node and in the browser, so they do
 * not use `node:path`. Stillwatch Phase 1 supports macOS and Linux only.
 */

/** macOS exposes these system directories through /private. */
const DARWIN_PRIVATE_PREFIXES = ['/private/tmp', '/private/var', '/private/etc'] as const;

/**
 * Lexically normalizes a path: collapses repeated slashes, resolves "." and
 * "..", and removes a trailing slash. It never touches the filesystem.
 * Relative input is returned normalized but still relative.
 * Use `pathKey` (not this) when comparing paths from different sources.
 */
export function canonicalPath(input: string): string {
  if (input === '') return '';
  const absolute = input.startsWith('/');
  const parts: string[] = [];
  for (const segment of input.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
      else if (!absolute) parts.push('..');
      continue;
    }
    parts.push(segment);
  }
  const out = (absolute ? '/' : '') + parts.join('/');
  if (out === '') return absolute ? '/' : '.';
  return out;
}

/**
 * Comparison key for a path: `canonicalPath` plus folding macOS
 * `/private/tmp`, `/private/var`, and `/private/etc` onto `/tmp`, `/var`,
 * and `/etc`, so a realpath and its symlinked spelling compare equal.
 * Use keys for equality and maps only. Display and filesystem access use the original path.
 */
export function pathKey(input: string): string {
  const out = canonicalPath(input);
  for (const prefix of DARWIN_PRIVATE_PREFIXES) {
    if (out === prefix || out.startsWith(`${prefix}/`)) return out.slice('/private'.length);
  }
  return out;
}

/** Joins segments with "/" and normalizes the result. Absolute later segments do not reset. */
export function joinPath(...segments: string[]): string {
  return canonicalPath(segments.filter((s) => s !== '').join('/'));
}

/**
 * Resolves `target` against `base` (both POSIX). Expands a leading `~` or
 * `$HOME` / `${HOME}` with `home`. Returns a canonical absolute path.
 */
export function resolvePath(base: string, target: string, home: string): string {
  let t = target;
  if (t === '~') t = home;
  else if (t.startsWith('~/')) t = home + t.slice(1);
  else if (t === '$HOME' || t === '${HOME}') t = home;
  else if (t.startsWith('$HOME/')) t = home + t.slice(5);
  else if (t.startsWith('${HOME}/')) t = home + t.slice(7);
  if (t.startsWith('/')) return canonicalPath(t);
  return canonicalPath(`${base}/${t}`);
}

/** True when `child` equals `parent` or is inside it. Compares path keys. */
export function isWithin(child: string, parent: string): boolean {
  const c = pathKey(child);
  const p = pathKey(parent);
  if (p === '/') return c.startsWith('/');
  return c === p || c.startsWith(`${p}/`);
}

/** Path of `target` relative to `base`, or `null` when it is outside `base`. Compares path keys. */
export function relativeTo(target: string, base: string): string | null {
  const t = pathKey(target);
  const b = pathKey(base);
  if (t === b) return '.';
  if (b === '/') return t.slice(1);
  if (!t.startsWith(`${b}/`)) return null;
  return t.slice(b.length + 1);
}

/** Last path segment. */
export function baseName(p: string): string {
  const c = canonicalPath(p);
  const i = c.lastIndexOf('/');
  return i === -1 ? c : c.slice(i + 1);
}

/** Path without its last segment. */
export function dirName(p: string): string {
  const c = canonicalPath(p);
  const i = c.lastIndexOf('/');
  if (i <= 0) return c.startsWith('/') ? '/' : '.';
  return c.slice(0, i);
}

/** Displays `p` relative to `base` when inside it, with `~` for the home directory otherwise. */
export function displayPath(p: string, base: string | null, home: string | null): string {
  if (base) {
    const rel = relativeTo(p, base);
    if (rel !== null && rel !== '.') return rel;
  }
  if (home) {
    const rel = relativeTo(p, home);
    if (rel !== null) return rel === '.' ? '~' : `~/${rel}`;
  }
  return canonicalPath(p);
}

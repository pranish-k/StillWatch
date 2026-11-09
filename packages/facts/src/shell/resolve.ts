/**
 * Resolves shell words to absolute paths against the effective cwd and home.
 */
import { canonicalPath, resolvePath } from '@stillwatch/schema';
import type { Word } from './types';

export type ResolvedPath = { path: string; unresolved: boolean };

const HOME_FORMS = ['~', '$HOME', '${HOME}'];

function startsWithHome(text: string): boolean {
  return HOME_FORMS.some((form) => text === form || text.startsWith(`${form}/`));
}

/**
 * Resolves `text` to an absolute canonical path when possible.
 * `~`, `$HOME`, and `${HOME}` prefixes expand to `home`; other variables keep
 * their text and mark the result unresolved, as does a relative path with no
 * known cwd.
 */
export function resolveText(
  text: string,
  cwd: string | null,
  home: string,
  dynamic: boolean,
  literalTilde = false,
): ResolvedPath | null {
  if (text === '') return null;
  let t = text;
  if (literalTilde && t.startsWith('~')) t = `./${t}`;
  if (startsWithHome(t)) return { path: resolvePath('/', t, home), unresolved: dynamic };
  if (t.startsWith('/')) return { path: canonicalPath(t), unresolved: dynamic };
  if (t.startsWith('$') || t.startsWith('~')) return { path: t, unresolved: true };
  if (cwd === null) return { path: canonicalPath(t), unresolved: true };
  return { path: resolvePath(cwd, t, home), unresolved: dynamic };
}

export function resolveWord(word: Word, cwd: string | null, home: string): ResolvedPath | null {
  return resolveText(word.value, cwd, home, word.dynamic || word.glob, word.literalTilde);
}

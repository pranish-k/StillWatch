/**
 * Internal shell parse structures. They carry more detail than the public
 * `ShellCommand` (quoting, expansions, substitution links) so fact
 * extraction can tell literal paths from dynamic ones.
 */

/** One shell word after quote removal. */
export type Word = {
  /** Value after quote removal. Expansions are kept as their source text, e.g. `$FOO` or `$(date)`. */
  value: string;
  /** Source text of the word. */
  raw: string;
  /** Contains a parameter expansion (other than HOME), command substitution, or arithmetic. */
  dynamic: boolean;
  /** Contains an unquoted glob or brace pattern. */
  glob: boolean;
  /** Starts with a `~` that the shell would not expand (quoted or escaped). */
  literalTilde: boolean;
  /** Indices of commands parsed from substitutions inside this word. */
  subst: number[];
  /** True when any part of the word was quoted or escaped. */
  quoted: boolean;
};

export type Redirect = {
  /** Operator with any file descriptor prefix, e.g. ">", "2>>", ">&", "<<". */
  op: string;
  target: Word;
};

export type ParsedCommand = {
  words: Word[];
  assignments: Word[];
  redirects: Redirect[];
  depth: number;
  background: boolean;
  pipedFrom: number | null;
  cwd: string | null;
  /** Source text of the simple command, capped. */
  text: string;
};

export type ParseResult = { commands: ParsedCommand[]; truncated: boolean };

/** Builds a word that holds part of another word, such as an option value after `=`. */
export function deriveWord(from: Word, value: string): Word {
  return {
    value,
    raw: value,
    dynamic: from.dynamic,
    glob: from.glob,
    literalTilde: false,
    subst: from.subst,
    quoted: from.quoted,
  };
}

/** Builds a plain literal word. */
export function literalWord(value: string): Word {
  return {
    value,
    raw: value,
    dynamic: false,
    glob: false,
    literalTilde: false,
    subst: [],
    quoted: false,
  };
}

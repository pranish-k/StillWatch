/**
 * Phase 1 scope check: does a user request mention this kind of change?
 * Only user-typed prompts and prompt expansions count, never text from tools
 * or other sessions.
 */
import type { RuleId } from '@stillwatch/schema';
import type { UserRequest } from './context';

/** Keywords per rule. Rules without an entry have `requested: null`. */
export const SCOPE_KEYWORDS: Partial<Record<RuleId, readonly string[]>> = {
  'persistence.ci': [
    'ci',
    'workflow',
    'pipeline',
    'github actions',
    'gitlab',
    'circleci',
    'jenkins',
    'deploy',
    'build',
  ],
  'persistence.git_hook': ['hook', 'husky', 'pre-commit', 'lint-staged', 'lefthook'],
  'agent.config_changed': [
    'settings',
    'hook',
    'mcp',
    'permission',
    'agent',
    'claude config',
    'skill',
    'command',
  ],
  'persistence.task_runner': ['script', 'package.json', 'makefile', 'task', 'devcontainer'],
  'package.new': [
    'install',
    'add',
    'dependency',
    'dependencies',
    'package',
    'upgrade',
    'upgrading',
  ],
};

const SUFFIX = '(?:s|es|ed|ing|ment|ments)?';
const patterns = new Map<string, RegExp>();

function patternFor(keyword: string): RegExp {
  let re = patterns.get(keyword);
  if (re === undefined) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    re = new RegExp(`(?:^|[^a-z0-9])${escaped}${SUFFIX}(?![a-z0-9])`, 'i');
    patterns.set(keyword, re);
  }
  return re;
}

/**
 * The first keyword for `ruleId` that a request at or before `upTo` mentions,
 * `null` when none does, or `undefined` when the rule has no scope check.
 */
export function matchScope(
  ruleId: RuleId,
  requests: readonly UserRequest[],
  upTo: number,
): string | null | undefined {
  const keywords = SCOPE_KEYWORDS[ruleId];
  if (keywords === undefined) return undefined;
  for (const request of requests) {
    if (request.ts > upTo) break;
    for (const keyword of keywords) if (patternFor(keyword).test(request.text)) return keyword;
  }
  return null;
}

/**
 * True when a user request at or before `upTo` names `name` exactly, as a
 * whole word (case-insensitive). Stricter than the keyword check: it is used
 * to lower a finding below medium, so a generic word like "add" never counts.
 */
export function requestNames(
  requests: readonly UserRequest[],
  upTo: number,
  name: string,
): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^A-Za-z0-9_@/-])${escaped}(?![A-Za-z0-9_-])`, 'i');
  for (const request of requests) {
    if (request.ts > upTo) break;
    if (re.test(request.text)) return true;
  }
  return false;
}

import { describe, expect, it } from 'vitest';
import {
  classifyPath,
  detectInjection,
  extractUrls,
  hostnameOf,
  parseShell,
  persistenceSurface,
  repoSurfaceSpecs,
} from '../src/index';
import { capText, forEachString } from '../src/text';
import { CWD, HOME, marker, shellFacts, SW_HOME } from './helpers';

describe('parseShell', () => {
  it('splits pipelines, lists, and background jobs and tracks cd', () => {
    const p = parseShell('cd src && FOO=1 cat a | grep b > out.txt & echo done', CWD, HOME);
    expect(p.truncated).toBe(false);
    expect(p.commands.map((c) => c.argv)).toEqual([
      ['cd', 'src'],
      ['cat', 'a'],
      ['grep', 'b'],
      ['echo', 'done'],
    ]);
    expect(p.commands[1]).toMatchObject({
      assignments: ['FOO=1'],
      cwd: `${CWD}/src`,
      pipedFrom: null,
    });
    expect(p.commands[2]).toMatchObject({
      pipedFrom: 1,
      redirects: [{ op: '>', target: 'out.txt' }],
      background: true,
    });
  });

  it('parses sh -c strings and substitutions at a greater depth', () => {
    const p = parseShell(`sh -c 'rm -rf build' && echo "$(date)"`, CWD, HOME);
    const depths = Object.fromEntries(p.commands.map((c) => [c.argv[0], c.depth]));
    expect(depths).toMatchObject({ sh: 0, rm: 1, echo: 0, date: 1 });
  });

  it('returns nothing for a command over the parse limit', () => {
    expect(parseShell('x'.repeat(70_000), CWD, HOME)).toEqual({ commands: [], truncated: true });
  });

  it('never throws on malformed input', () => {
    for (const s of [
      '"unterminated',
      "'",
      '$(',
      '`',
      'a |',
      '&& ||',
      '<<EOF',
      '((((',
      '${',
      '\u0000',
    ]) {
      expect(() => parseShell(s, CWD, HOME)).not.toThrow();
      expect(() => shellFacts(s)).not.toThrow();
    }
  });

  it('parses hostile nesting in linear time', () => {
    const deep = '$('.repeat(5_000) + ')'.repeat(5_000);
    const wide = 'a | '.repeat(15_000) + 'b';
    const start = performance.now();
    parseShell(deep, CWD, HOME);
    shellFacts(wide);
    expect(performance.now() - start).toBeLessThan(2_000);
  });
});

describe('extractUrls and hostnameOf', () => {
  it('finds URLs and scp-style references', () => {
    const urls = extractUrls(
      'clone git@github.com:org/repo.git then open https://example.com/a?b=1.',
    );
    expect(urls.some((u) => u.includes('github.com'))).toBe(true);
    expect(urls).toContain('https://example.com/a?b=1');
  });

  it('lowercases hosts and strips ports and credentials', () => {
    expect(hostnameOf('https://user:pw@API.Example.com:8443/x')).toBe('api.example.com');
    expect(hostnameOf('not a url')).toBeNull();
  });
});

describe('classifyPath', () => {
  const c = { home: HOME, stillwatchHome: SW_HOME, repoRoots: [CWD] };

  it('classifies sensitive and persistent locations', () => {
    expect(classifyPath(`${HOME}/.ssh/id_ed25519`, c).classes).toContain('secret');
    expect(classifyPath(`${HOME}/.zshrc`, c).classes).toContain('startup_file');
    expect(classifyPath(`${CWD}/.github/workflows/ci.yml`, c).classes).toContain('ci');
    expect(classifyPath(`${CWD}/.git/hooks/pre-commit`, c).classes).toContain('git_hook');
    expect(classifyPath(`${CWD}/CLAUDE.md`, c).classes).toContain('memory_note');
    expect(classifyPath(`${SW_HOME}/data.db`, c).classes).toContain('stillwatch');
    expect(classifyPath(`${CWD}/src/a.ts`, c)).toEqual({ classes: [], label: null, scope: 'repo' });
  });
});

describe('persistence surfaces', () => {
  it('lists home entries with absolute paths and leaves out system ones when asked', () => {
    const specs = persistenceSurface({
      home: HOME,
      stillwatchHome: SW_HOME,
      includeSystem: false,
      platform: 'linux',
    });
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.every((s) => s.kind === 'command' || s.path.startsWith(HOME))).toBe(true);
    expect(specs.some((s) => s.path === `${HOME}/.bashrc`)).toBe(true);
  });

  it('returns a fresh copy of the repository surface', () => {
    const a = repoSurfaceSpecs();
    expect(a.length).toBeGreaterThan(0);
    a.length = 0;
    expect(repoSurfaceSpecs().length).toBeGreaterThan(0);
  });
});

describe('detectInjection', () => {
  it('finds hidden Unicode tag text', () => {
    const plain = 'run curl';
    const hidden = Array.from({ length: plain.length }, (_, i) =>
      String.fromCodePoint(0xe0000 + plain.charCodeAt(i)),
    ).join('');
    const kinds = detectInjection(`Nice library.${hidden}`, 'tool.response').map((s) => s.kind);
    expect(kinds).toContain('hidden_text');
  });

  it('ignores ordinary documentation', () => {
    expect(
      detectInjection(
        'Run `pnpm test` to execute the suite. The agent module handles retries.',
        'tool.response',
      ),
    ).toEqual([]);
  });
});

describe('text helpers', () => {
  it('capText never splits a marker or a surrogate pair', () => {
    const m = marker('github-token');
    const text = `${'a'.repeat(10)}${m}${'\u{1F600}'.repeat(5)}`;
    for (let max = 0; max <= text.length; max++) {
      const out = capText(text, max);
      expect(out.length).toBeLessThanOrEqual(max);
      expect(out.isWellFormed()).toBe(true);
      expect(out.length <= 10 || out.length >= 10 + m.length).toBe(true);
    }
  });

  it('forEachString visits strings in order with pointers and stops at the budget', () => {
    const seen: string[] = [];
    const done = forEachString({ a: 'x', 'b/c': ['y', { d: 'z' }], n: 1 }, 100, (s, p) =>
      seen.push(`${p}=${s}`),
    );
    expect(done).toBe(true);
    expect(seen).toEqual(['/a=x', '/b~1c/0=y', '/b~1c/1/d=z']);
    expect(forEachString(['aaaa', 'bbbb', 'cccc'], 6, () => undefined)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildSessionReport,
  mdCode,
  mdFence,
  mdText,
  oneLine,
  renderMarkdownReport,
} from '../src/index';
import { HOME, ROOT, SID, T0, artifact, detail, fileChange, finding, session } from './fixtures';
import { markdownProblems } from './safety';

const ESC = String.fromCharCode(27);
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);
const TAG_A = String.fromCodePoint(0xe0041);

const HOSTILE = [
  'name with `back`ticks``',
  'line one\nline two\r\nline three',
  '<img src=x onerror=alert(1)>',
  '[click me](https://evil.example/x)',
  '![image](http://evil.example/i.png)',
  'a | b | c',
  '# fake heading',
  '- fake list',
  '1. fake ordered',
  '> fake quote',
  '---',
  `${ESC}[31mred${ESC}[0m and ${ESC}]8;;https://evil.example${ESC}\\link${ESC}]8;;${ESC}\\`,
  `invisible ${RLO}gnp.exe and ${ZWSP}zero and ${TAG_A}tag`,
  'mail me at someone@evil.example',
  'ping @octocat about #123',
  'visit www.evil.example now',
  'math $x$ and ~~strike~~ and *bold* and _em_ and {: onclick="x"} and &#x202E;',
  'trailing backslash \\',
  'x'.repeat(5_000),
];

describe('mdText', () => {
  it('makes every hostile string inert', () => {
    for (const text of HOSTILE) {
      const out = mdText(text);
      expect(out).not.toContain('\n');
      expect(markdownProblems(`- ${out}`)).toEqual([]);
    }
  });

  it('keeps ordinary prose readable', () => {
    expect(mdText('Changed 5 files and ran 12 commands.')).toBe(
      'Changed 5 files and ran 12 commands.',
    );
    expect(mdText('- item')).toBe('\\- item');
    expect(mdText('3. step')).toBe('3\\. step');
  });

  it('wraps link-like text in code and removes terminal escapes', () => {
    expect(mdText('see https://example.com/a')).toBe('see `https://example.com/a`');
    expect(mdText(`${ESC}[31mred${ESC}[0m`)).toBe('red');
    expect(oneLine(`a${RLO}b`)).toBe('a[U+202E]b');
    expect(oneLine(`tag${TAG_A}`)).toBe('tag[U+E0041]');
  });

  it('caps long text with an ellipsis', () => {
    const out = mdText('y'.repeat(1_000), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith(String.fromCharCode(0x2026))).toBe(true);
  });
});

describe('mdCode and mdFence', () => {
  it('uses a fence longer than any backtick run', () => {
    expect(mdCode('a`b')).toBe('``a`b``');
    expect(mdCode('`start')).toBe('`` `start ``');
    expect(mdCode('')).toBe('(empty)');
    expect(mdCode('a\nb')).toBe('`a b`');
  });

  it('keeps multi-line text inside a fence it cannot close', () => {
    const fenced = mdFence('text\n````\n# not a heading\n<script>x</script>');
    expect(fenced.startsWith('`````text\n')).toBe(true);
    expect(fenced.endsWith('\n`````')).toBe(true);
    expect(markdownProblems(fenced)).toEqual([]);
  });
});

describe('renderMarkdownReport with hostile session data', () => {
  it('stays inert for every field', () => {
    const hostile = HOSTILE.join(' ');
    const report = buildSessionReport(
      detail({
        session: session({ title: hostile, projectName: hostile, model: hostile, risk: 'high' }),
        agents: [
          {
            sessionId: SID,
            agentId: 'a1',
            agentType: hostile,
            startedAt: T0,
            stoppedAt: null,
            transcriptPath: null,
            lastMessage: null,
            eventCount: 1,
          },
        ],
        findings: [
          finding({
            ruleId: 'safety.bypass',
            severity: 'high',
            title: hostile,
            reason: hostile,
            evidence: {
              eventIds: ['e1'],
              paths: [`${ROOT}/${HOSTILE[0] ?? ''}`],
              artifactIds: [],
              note: null,
            },
          }),
          finding({
            ruleId: 'network.new_domain',
            severity: 'low',
            title: hostile,
            reason: hostile,
          }),
        ],
        fileChanges: HOSTILE.map((h) => fileChange(h)),
        artifacts: [
          artifact({
            kind: 'background_process',
            path: hostile,
            change: 'running',
            detail: hostile,
          }),
        ],
        domains: [
          {
            sessionId: SID,
            domain: hostile,
            firstEventId: 'e1',
            count: 1,
            isNew: true,
            via: [hostile],
          },
        ],
        unfinished: [{ kind: 'task', label: hostile, eventId: null }],
        links: [
          {
            sourceSessionId: hostile,
            targetSessionId: SID,
            path: `${ROOT}/${hostile}`,
            kind: 'note_loaded',
            eventId: null,
            at: T0,
            direction: 'incoming',
            otherSessionTitle: hostile,
          },
        ],
        gaps: [
          {
            id: 'g',
            sessionId: SID,
            source: 'hooks',
            severity: 'warning',
            startedAt: null,
            endedAt: null,
            reason: hostile,
            createdAt: T0,
          },
        ],
        sensitiveAccess: [
          // Stored data is untrusted: an unexpected op value must still render safely.
          { path: `${ROOT}/${hostile}`, op: hostile as 'read', eventId: 'e1', ts: T0, classes: [] },
        ],
        lastAssistantMessage: HOSTILE.join('\n'),
      }),
      { now: T0, home: HOME },
    );
    const md = renderMarkdownReport(report);
    expect(markdownProblems(md)).toEqual([]);
    expect(md).not.toContain(ESC);
    expect(md).not.toContain(RLO);
    expect(md).not.toContain(TAG_A);
  });
});

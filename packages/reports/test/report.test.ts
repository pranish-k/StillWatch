import { describe, expect, it } from 'vitest';
import { REPORT_VERSION } from '@stillwatch/schema';
import { REPORT_LIMITS, buildSessionReport, renderMarkdownReport } from '../src/index';
import {
  HOME,
  ROOT,
  SID,
  T0,
  detail,
  finding,
  gap,
  highRiskDetail,
  session,
  stats,
} from './fixtures';
import { markdownProblems } from './safety';

const EM_DASH = String.fromCharCode(0x2014);
const NOW = T0 + 20 * 60_000;

describe('buildSessionReport', () => {
  it('fills the model for a high-risk interrupted session', () => {
    const report = buildSessionReport(highRiskDetail(), { now: NOW, home: HOME });
    expect(report.v).toBe(REPORT_VERSION);
    expect(report.generatedAt).toBe(NOW);
    expect(report.agentLabel).toBe('Claude Code, with 2 subagents');
    expect(report.statusLabel).toBe('Interrupted');
    expect(report.riskLabel).toBe('High');
    expect(report.project).toBe('demo');
    expect(report.durationMs).toBe(12 * 60_000);
    expect(report.whyRisk.map((f) => f.ruleId)).toEqual([
      'persistence.ci',
      'persistence.git_hook',
      'secret.read',
    ]);
    expect(report.otherFindings.map((f) => f.ruleId)).toEqual(['memory.note_written']);
    expect(report.filesChanged.map((f) => f.display)).toEqual([
      '.github/workflows/deploy.yml',
      'src/auth/session.ts',
      'tests/auth/session.test.ts',
    ]);
    expect(report.sensitiveAccess).toEqual([
      { path: `${ROOT}/.env.test`, display: '.env.test', op: 'read', eventId: 'e3' },
    ]);
    expect(report.network.map((n) => n.domain)).toEqual(['api.example.com', 'registry.npmjs.org']);
    expect(report.networkNote).toMatch(/not a network log/);
    expect(report.whatRemains.map((r) => r.display)).toEqual(['.git/hooks/pre-push', 'NOTES.md']);
    expect(report.related[0]?.sessionId).toBe('9c1e44d0-1111-2222-3333-444455556666');
    expect(report.subagents).toEqual([
      { id: 'a1', type: 'Explore' },
      { id: 'b2', type: 'Plan' },
    ]);
    expect(report.limits).toEqual([...REPORT_LIMITS]);
    expect(report.summary.length).toBeLessThanOrEqual(4);
    expect(report.summary[0]).toBe(
      'The agent changed 3 files, ran 7 commands, and read 9 files, with help from 2 subagents.',
    );
    expect(report.summary[1]).toBe('It stopped before finishing "Deployment notes".');
  });

  it('is deterministic and does not mutate its input', () => {
    const input = highRiskDetail();
    const before = JSON.stringify(input);
    const a = buildSessionReport(input, { now: NOW, home: HOME });
    const b = buildSessionReport(input, { now: NOW, home: HOME });
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('falls back for missing titles, unknown time, and blank messages', () => {
    const report = buildSessionReport(
      detail({
        session: session({ title: '   ', analyzedAt: null }),
        lastAssistantMessage: '  \n ',
      }),
    );
    expect(report.title).toBe('Untitled session');
    expect(report.generatedAt).toBe(T0 + 12 * 60_000);
    expect(report.agentReported).toBeNull();
    expect(report.agentLabel).toBe('Claude Code');
  });

  it('uses the singular for one subagent and ~ for home paths', () => {
    const report = buildSessionReport(
      detail({
        session: session({ subagentCount: 1, projectName: null }),
        sensitiveAccess: [
          {
            path: `${HOME}/.ssh/id_ed25519`,
            op: 'read',
            eventId: 'e1',
            ts: T0,
            classes: ['secret'],
          },
        ],
      }),
      { home: HOME },
    );
    expect(report.agentLabel).toBe('Claude Code, with 1 subagent');
    expect(report.project).toBe('~/projects/demo');
    expect(report.sensitiveAccess[0]?.display).toBe('~/.ssh/id_ed25519');
  });
});

describe('renderMarkdownReport golden files', () => {
  it('renders the high-risk interrupted session', async () => {
    const md = renderMarkdownReport(buildSessionReport(highRiskDetail(), { now: NOW, home: HOME }));
    await expect(md).toMatchFileSnapshot('./golden/high-risk-interrupted.md');
    expect(markdownProblems(md)).toEqual([]);
  });

  it('renders a quiet low-risk session', async () => {
    const md = renderMarkdownReport(
      buildSessionReport(
        detail({
          session: session({ title: 'Rename a helper', fileChangeCount: 1 }),
          fileChanges: [],
          stats: stats({ commands: 2, filesRead: 3, filesWritten: 0 }),
          lastAssistantMessage: 'Renamed the helper.',
        }),
        { now: NOW, home: HOME },
      ),
    );
    await expect(md).toMatchFileSnapshot('./golden/quiet-low-risk.md');
    expect(md).toContain('Nothing notable');
    expect(markdownProblems(md)).toEqual([]);
  });

  it('renders an unknown-risk session with capture gaps', async () => {
    const md = renderMarkdownReport(
      buildSessionReport(
        detail({
          session: session({
            risk: 'unknown',
            status: 'active',
            endReason: null,
            title: 'Update deps',
          }),
          gaps: [
            gap({ severity: 'warning', reason: '3 spool records could not be read.' }),
            gap({
              severity: 'critical',
              reason:
                'Stillwatch was not running when the session began, so the start state is unknown.',
            }),
            gap({ severity: 'warning', reason: '3 spool records could not be read.' }),
          ],
          findings: [
            finding({
              ruleId: 'network.new_domain',
              severity: 'low',
              title: 'New domain contacted',
            }),
          ],
        }),
        { now: NOW, home: HOME },
      ),
    );
    await expect(md).toMatchFileSnapshot('./golden/unknown-risk-gaps.md');
    expect(md.match(/spool records/g)).toHaveLength(1);
    expect(md).toContain('Risk: Unknown (important data is missing; see Capture gaps)');
    expect(markdownProblems(md)).toEqual([]);
  });

  it('never uses the em dash and ends with exactly one newline', () => {
    for (const d of [highRiskDetail(), detail()]) {
      const md = renderMarkdownReport(buildSessionReport(d, { now: NOW, home: HOME }));
      expect(md.includes(EM_DASH)).toBe(false);
      expect(md.endsWith('\n')).toBe(true);
      expect(md.endsWith('\n\n')).toBe(false);
      expect(md).not.toMatch(/\n{3,}/);
    }
  });

  it('caps long lists with an "and N more" line', () => {
    const many = Array.from({ length: 205 }, (_, i) => ({
      sessionId: SID,
      path: `${ROOT}/f${String(i).padStart(3, '0')}.txt`,
      repoRoot: ROOT,
      relPath: `f${String(i)}.txt`,
      change: 'added' as const,
      oldPath: null,
      additions: null,
      deletions: null,
      binary: false,
      classes: [],
      attribution: 'tool' as const,
      eventIds: [],
      committed: false,
    }));
    const md = renderMarkdownReport(
      buildSessionReport(detail({ fileChanges: many }), { now: NOW }),
    );
    expect(md).toContain('- and 5 more files');
  });
});

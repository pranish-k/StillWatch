/**
 * All mock sessions: one high (spec sample), one medium, one unknown with
 * capture gaps, one active, and many low sessions (one with a hostile title).
 */
import type { StatusResponse } from '@stillwatch/schema';
import { IMG_TAG, LONG_PATH, MARKDOWN, SCRIPT_TAG } from './adversarial';
import { assemble, type MockSession } from './assemble';
import { TimelineBuilder } from './builder';
import { buildHighRisk, finding, HIGH_ID, RELATED_ID } from './highRisk';

export const MEDIUM_ID = 'a3d8f1e2-7c4b-4a9e-b2d0-1f5e6c7a8b90';
export const UNKNOWN_ID = 'd4e5f6a7-1b2c-4d3e-8f9a-0b1c2d3e4f50';
export const ACTIVE_ID = 'e5f6a7b8-2c3d-4e5f-9a0b-1c2d3e4f5a61';
export const HOSTILE_ID = 'f6a7b8c9-3d4e-4f5a-8b1c-2d3e4f5a6b72';

const HOUR = 3600_000;

function medium(now: number): MockSession {
  const root = '/Users/dev/code/billing-api';
  const b = new TimelineBuilder(MEDIUM_ID, 'ev-md-', root, now - 5 * HOUR, 30_000);
  b.sessionStart('claude-sonnet-4-5');
  b.prompt('Add rate limiting to the public API endpoints.');
  b.routine(['src/server.ts', 'src/routes/public.ts', 'src/middleware/index.ts'], 8);
  const pkg = b.bash('npm install express-rate-limit@7.4.0', 'added 1 package', {
    findingIds: [`f-${MEDIUM_ID.slice(0, 4)}-package.new`],
    facts: { packages: [{ manager: 'npm', action: 'add', names: ['express-rate-limit@7.4.0'] }] },
  });
  b.write(`${root}/src/middleware/rateLimit.ts`, 'export const limiter = rateLimit({ max: 100 });');
  b.routine(['src/middleware/rateLimit.ts', 'tests/rateLimit.test.ts'], 10);
  b.stop('Rate limiting is in place for /public routes, 100 requests per minute.');
  b.prompt('Write a short note for the team about the new limits.');
  const note = b.write(`${root}/AGENTS.md`, '## Rate limits\nAlways keep max at 100.');
  b.stop('Added a section to AGENTS.md.');
  b.sessionEnd('prompt_input_exit');
  const sid = MEDIUM_ID;
  return assemble({
    id: sid,
    title: 'Add rate limiting to the public API',
    projectName: 'billing-api',
    projectRoot: root,
    status: 'finished',
    endReason: 'prompt_input_exit',
    risk: 'medium',
    riskReasons: ['A new dependency was added', 'An agent instruction file changed'],
    model: 'claude-sonnet-4-5',
    summary: [
      'The agent added rate limiting middleware to the public routes and tests for it.',
      'It added one npm package and a note to AGENTS.md.',
    ],
    events: b.events,
    findings: [
      finding(
        sid,
        'package.new',
        'medium',
        'New package added',
        'express-rate-limit@7.4.0 was installed with npm.',
        [pkg],
        [`${root}/package.json`],
        true,
      ),
      finding(
        sid,
        'memory.note_written',
        'medium',
        'Agent instruction file changed',
        'AGENTS.md is loaded by future sessions. You asked for a team note, not for agent instructions.',
        [note],
        [`${root}/AGENTS.md`],
        false,
      ),
    ],
    fileChanges: [
      {
        sessionId: sid,
        path: `${root}/src/middleware/rateLimit.ts`,
        repoRoot: root,
        relPath: 'src/middleware/rateLimit.ts',
        change: 'added',
        oldPath: null,
        additions: 31,
        deletions: 0,
        binary: false,
        classes: [],
        attribution: 'tool',
        eventIds: [],
        committed: false,
      },
      {
        sessionId: sid,
        path: `${root}/package.json`,
        repoRoot: root,
        relPath: 'package.json',
        change: 'modified',
        oldPath: null,
        additions: 1,
        deletions: 0,
        binary: false,
        classes: ['package_manifest', 'task_runner'],
        attribution: 'shell',
        eventIds: [pkg.id],
        committed: false,
      },
      {
        sessionId: sid,
        path: `${root}/AGENTS.md`,
        repoRoot: root,
        relPath: 'AGENTS.md',
        change: 'modified',
        oldPath: null,
        additions: 2,
        deletions: 0,
        binary: false,
        classes: ['memory_note'],
        attribution: 'tool',
        eventIds: [note.id],
        committed: false,
      },
    ],
    artifacts: [
      {
        id: 'a-md',
        sessionId: sid,
        kind: 'memory_note',
        path: `${root}/AGENTS.md`,
        change: 'modified',
        hashAfter: null,
        source: 'tool',
        eventIds: [note.id],
        detail: 'Loaded by every future agent session in this repository',
      },
    ],
    domains: [
      {
        sessionId: sid,
        domain: 'registry.npmjs.org',
        firstEventId: pkg.id,
        count: 1,
        isNew: false,
        via: ['npm'],
      },
    ],
    lastAssistantMessage: 'Rate limiting is live on /public and documented in AGENTS.md.',
  });
}

function unknownRisk(now: number): MockSession {
  const root = '/Users/dev/code/acme-web';
  const b = new TimelineBuilder(UNKNOWN_ID, 'ev-un-', root, now - 26 * HOUR, 20_000);
  b.prompt('Upgrade TypeScript to 6.0 and fix the new errors.');
  b.routine(['tsconfig.json', 'src/index.ts', 'src/types.ts'], 9);
  b.stop('Upgraded TypeScript; 3 errors fixed.');
  b.sessionEnd('clear');
  return assemble({
    id: UNKNOWN_ID,
    title: 'Upgrade TypeScript to 6.0',
    projectName: 'acme-web',
    projectRoot: root,
    status: 'finished',
    endReason: 'clear',
    risk: 'unknown',
    riskReasons: ['Important capture data is missing'],
    model: 'claude-sonnet-4-5',
    summary: [
      'The agent upgraded TypeScript and fixed type errors in three files.',
      'Stillwatch missed the start of this session, so changes made before the first recorded event are unknown.',
    ],
    events: b.events,
    fileChanges: [
      {
        sessionId: UNKNOWN_ID,
        path: `${root}/tsconfig.json`,
        repoRoot: root,
        relPath: 'tsconfig.json',
        change: 'modified',
        oldPath: null,
        additions: 2,
        deletions: 2,
        binary: false,
        classes: [],
        attribution: 'tool',
        eventIds: [],
        committed: false,
      },
      {
        sessionId: UNKNOWN_ID,
        path: `${root}/src/legacy.ts`,
        repoRoot: root,
        relPath: 'src/legacy.ts',
        change: 'deleted',
        oldPath: null,
        additions: null,
        deletions: null,
        binary: false,
        classes: [],
        attribution: 'unattributed',
        eventIds: [],
        committed: false,
      },
    ],
    gaps: [
      {
        id: 'g-un-1',
        sessionId: UNKNOWN_ID,
        source: 'snapshot',
        severity: 'critical',
        startedAt: null,
        endedAt: null,
        reason: 'No start snapshot: the collector was not running when the session began.',
        createdAt: now,
      },
      {
        id: 'g-un-2',
        sessionId: UNKNOWN_ID,
        source: 'spool',
        severity: 'warning',
        startedAt: now - 26 * HOUR,
        endedAt: now - 25 * HOUR,
        reason: '12 spool records could not be read and were discarded.',
        createdAt: now,
      },
      {
        id: 'g-un-3',
        sessionId: UNKNOWN_ID,
        source: 'hooks',
        severity: 'info',
        startedAt: null,
        endedAt: null,
        reason: 'SessionStart was not received; the first recorded event is a prompt.',
        createdAt: now,
      },
    ],
    lastAssistantMessage: 'TypeScript 6.0 is in and the build is green.',
  });
}

function active(now: number): MockSession {
  const root = '/Users/dev/code/storefront';
  const b = new TimelineBuilder(ACTIVE_ID, 'ev-ac-', root, now - 25 * 60_000, 50_000);
  b.sessionStart('claude-sonnet-4-5');
  b.prompt('Investigate the flaky checkout test.');
  b.routine(['tests/checkout.test.ts', 'src/checkout/cart.ts', 'src/checkout/payment.ts'], 10);
  b.stop('The test is flaky because of a shared timer; I made it deterministic.');
  b.prompt('Run it 50 times to be sure.');
  b.bash('for i in $(seq 50); do pnpm vitest run tests/checkout.test.ts; done', 'ok', {
    outcome: 'pending',
  });
  const last = b.events[b.events.length - 1];
  if (last) last.ts = now - 8000;
  return assemble({
    id: ACTIVE_ID,
    title: 'Investigate flaky checkout test',
    projectName: 'storefront',
    projectRoot: root,
    status: 'active',
    endReason: null,
    risk: 'low',
    riskReasons: [],
    model: 'claude-sonnet-4-5',
    summary: ['The agent is investigating a flaky checkout test and running it repeatedly.'],
    events: b.events,
    unfinished: [{ kind: 'turn', label: 'Run it 50 times to be sure.', eventId: null }],
  });
}

const LOW_TITLES = [
  'Rename getUser to fetchUser',
  'Update README install steps',
  'Fix typo in error message',
  'Add unit tests for date parser',
  'Bump eslint config',
  'Explain the caching layer',
  'Split utils into modules',
  'Remove dead feature flag',
  'Add loading state to profile page',
  'Fix dark mode contrast on buttons',
  'Document the release process',
  'Convert config loader to async',
  'Add pagination to orders list',
  'Fix off-by-one in pager',
  'Migrate tests to vitest',
  'Improve 404 page copy',
  'Add retry to webhook sender',
  'Refactor auth middleware',
  'Tidy imports in api package',
  'Speed up CI cache',
  'Add health check endpoint',
  'Fix flaky snapshot test',
  'Rewrite CSV export',
  'Review open TODOs',
];
const PROJECTS = ['acme-web', 'billing-api', 'storefront', 'docs-site', null] as const;

function low(now: number, i: number, title: string): MockSession {
  const project = PROJECTS[i % PROJECTS.length] ?? null;
  const root = project === null ? '/Users/dev' : `/Users/dev/code/${project}`;
  const id = `0${String(i).padStart(2, '0')}c0ffee-${String(1000 + i)}-4abc-9def-0123456789ab`;
  const b = new TimelineBuilder(id, `ev-l${i}-`, root, now - (10 + i * 9) * HOUR, 1000 * i);
  b.sessionStart('claude-sonnet-4-5');
  b.prompt(title);
  b.routine(['src/index.ts', 'src/util.ts', 'README.md'], 6 + (i % 5));
  b.stop(`Done: ${title.toLowerCase()}.`);
  b.sessionEnd('prompt_input_exit');
  const files = 1 + (i % 4);
  return assemble({
    id,
    title,
    projectName: project,
    projectRoot: project === null ? null : root,
    status: 'finished',
    endReason: 'prompt_input_exit',
    risk: 'low',
    riskReasons: [],
    model: 'claude-sonnet-4-5',
    summary: [
      `The agent worked on: ${title.toLowerCase()}.`,
      `It changed ${files} file${files === 1 ? '' : 's'} and ran the tests.`,
    ],
    events: b.events,
    fileChanges: Array.from({ length: files }, (_, k) => ({
      sessionId: id,
      path: `${root}/src/file${k}.ts`,
      repoRoot: root,
      relPath: `src/file${k}.ts`,
      change: 'modified' as const,
      oldPath: null,
      additions: 3 + k * 4,
      deletions: k,
      binary: false,
      classes: [],
      attribution: 'tool' as const,
      eventIds: [],
      committed: false,
    })),
    lastAssistantMessage: `Finished: ${title}.`,
  });
}

function hostile(now: number): MockSession {
  const root = '/Users/dev/code/acme-web';
  const b = new TimelineBuilder(HOSTILE_ID, 'ev-ho-', root, now - 30 * HOUR, 60_000);
  b.sessionStart('claude-sonnet-4-5');
  b.prompt(`${SCRIPT_TAG} ${IMG_TAG} ${MARKDOWN}`);
  b.routine([LONG_PATH.slice(root.length + 1), 'src/index.ts'], 7);
  b.stop(`${SCRIPT_TAG} done`);
  b.sessionEnd('other');
  return assemble({
    id: HOSTILE_ID,
    title: `${SCRIPT_TAG} Refactor ${MARKDOWN}`,
    projectName: IMG_TAG,
    projectRoot: root,
    status: 'finished',
    endReason: 'other',
    risk: 'low',
    riskReasons: [],
    model: 'claude-sonnet-4-5',
    summary: [`Summary with ${SCRIPT_TAG} and ${IMG_TAG}.`],
    events: b.events,
    fileChanges: [
      {
        sessionId: HOSTILE_ID,
        path: LONG_PATH,
        repoRoot: root,
        relPath: null,
        change: 'modified',
        oldPath: null,
        additions: 1,
        deletions: 1,
        binary: false,
        classes: [],
        attribution: 'tool',
        eventIds: [],
        committed: false,
      },
    ],
    lastAssistantMessage: `${IMG_TAG} I did everything. ${MARKDOWN}`,
  });
}

function related(now: number): MockSession {
  const root = '/Users/dev/code/acme-web';
  const b = new TimelineBuilder(RELATED_ID, 'ev-rl-', root, now - 2 * HOUR, 70_000);
  b.instructions(`${root}/NOTES.md`, 'Project');
  b.sessionStart('claude-sonnet-4-5');
  b.prompt('Prepare the release.');
  b.routine(['CHANGELOG.md', 'package.json'], 5);
  b.stop('Release prepared.');
  b.sessionEnd('prompt_input_exit');
  return assemble({
    id: RELATED_ID,
    title: 'Session 13: prepare release',
    projectName: 'acme-web',
    projectRoot: root,
    status: 'finished',
    endReason: 'prompt_input_exit',
    risk: 'low',
    riskReasons: [],
    model: 'claude-sonnet-4-5',
    summary: [
      'The agent prepared the release notes.',
      'It loaded NOTES.md written by an earlier session.',
    ],
    events: b.events,
    links: [
      {
        sourceSessionId: HIGH_ID,
        targetSessionId: RELATED_ID,
        path: `${root}/NOTES.md`,
        kind: 'note_loaded',
        eventId: b.events[0]?.id ?? null,
        at: now - 2 * HOUR,
        direction: 'incoming',
        otherSessionTitle: 'Fix login timeout',
      },
    ],
  });
}

export function buildSessions(now: number): MockSession[] {
  return [
    buildHighRisk(now),
    medium(now),
    unknownRisk(now),
    active(now),
    related(now),
    hostile(now),
    ...LOW_TITLES.map((title, i) => low(now, i + 1, title)),
  ];
}

export function buildStatus(now: number, sessions: MockSession[]): StatusResponse {
  return {
    version: '0.1.0',
    collector: { pid: 48213, startedAt: now - 3 * 24 * HOUR, port: 7391 },
    spool: { pending: 3, oldestAt: now - 4000, failedTotal: 12 },
    db: {
      path: '/Users/dev/.stillwatch/stillwatch.db',
      sizeBytes: 48_234_496,
      sessions: sessions.length,
      events: sessions.reduce((n, s) => n + s.events.length, 0),
    },
    hooks: {
      installed: true,
      scope: 'user',
      settingsPath: '/Users/dev/.claude/settings.json',
      events: [
        'SessionStart',
        'UserPromptSubmit',
        'PreToolUse',
        'PostToolUse',
        'Stop',
        'SessionEnd',
      ],
      missing: ['PostToolBatch'],
      outdated: [],
      hookScriptOk: true,
      claudeVersion: '2.1.318',
      compatible: true,
    },
    lastEventAt: now - 8000,
    retentionDays: 30,
    gaps: [
      {
        id: 'g-global-1',
        sessionId: null,
        source: 'collector',
        severity: 'warning',
        startedAt: now - 30 * HOUR,
        endedAt: now - 26 * HOUR,
        reason:
          'The collector was not running for 4 hours. Events were kept in the spool and imported later.',
        createdAt: now - 26 * HOUR,
      },
    ],
    warnings: [
      'PostToolBatch is not installed, so denied tool calls resolve later. Run `stillwatch install` to update hooks.',
    ],
  };
}

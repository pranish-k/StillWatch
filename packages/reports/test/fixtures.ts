import type {
  AgentRecord,
  Artifact,
  CaptureGap,
  FileChange,
  Finding,
  SessionDetail,
  SessionRecord,
  SessionStats,
} from '@stillwatch/schema';

export const HOME = '/Users/dev';
export const ROOT = '/Users/dev/projects/demo';
export const T0 = Date.UTC(2026, 10, 4, 23, 51, 0);
export const SID = '3f8a2b90-08fa-489f-87d6-7b5607f1099d';

export function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: SID,
    agent: 'claude-code',
    projectId: 'p1',
    projectRoot: ROOT,
    projectName: 'demo',
    cwd: ROOT,
    transcriptPath: null,
    title: 'Fix login timeout',
    startedAt: T0,
    endedAt: null,
    lastEventAt: T0 + 12 * 60_000,
    status: 'finished',
    endReason: 'other',
    risk: 'low',
    riskReasons: [],
    model: 'claude-opus-5',
    permissionMode: 'default',
    summary: null,
    eventCount: 40,
    findingCount: 0,
    fileChangeCount: 0,
    subagentCount: 0,
    analyzedAt: T0 + 13 * 60_000,
    analysisVersion: 1,
    chainHead: null,
    ...over,
  };
}

export function stats(over: Partial<SessionStats> = {}): SessionStats {
  return {
    toolCalls: 20,
    byCategory: { shell: 7, 'file.read': 9, 'file.edit': 4 },
    filesRead: 9,
    filesWritten: 3,
    commands: 7,
    failures: 0,
    prompts: 1,
    turns: 1,
    subagents: 0,
    permissionRequests: 0,
    denials: 0,
    durationMs: 12 * 60_000,
    ...over,
  };
}

export function finding(
  over: Partial<Finding> & Pick<Finding, 'ruleId' | 'severity' | 'title'>,
): Finding {
  return {
    id: `f-${over.ruleId}`,
    sessionId: SID,
    reason: '',
    subject: over.title,
    evidence: { eventIds: ['e1'], paths: [], artifactIds: [], note: null },
    requested: null,
    ts: T0 + 60_000,
    ...over,
  };
}

export function fileChange(rel: string, over: Partial<FileChange> = {}): FileChange {
  return {
    sessionId: SID,
    path: `${ROOT}/${rel}`,
    repoRoot: ROOT,
    relPath: rel,
    change: 'modified',
    oldPath: null,
    additions: 4,
    deletions: 1,
    binary: false,
    classes: [],
    attribution: 'tool',
    eventIds: ['e2'],
    committed: false,
    ...over,
  };
}

export function artifact(over: Partial<Artifact> & Pick<Artifact, 'kind' | 'path'>): Artifact {
  return {
    id: `a-${over.path}`,
    sessionId: SID,
    change: 'created',
    hashAfter: null,
    source: 'snapshot',
    eventIds: [],
    detail: null,
    ...over,
  };
}

export function subagent(id: string, type: string, startedAt: number): AgentRecord {
  return {
    sessionId: SID,
    agentId: id,
    agentType: type,
    startedAt,
    stoppedAt: null,
    transcriptPath: null,
    lastMessage: null,
    eventCount: 3,
  };
}

export function gap(
  over: Partial<CaptureGap> & Pick<CaptureGap, 'severity' | 'reason'>,
): CaptureGap {
  return {
    id: `g-${over.reason}`,
    sessionId: SID,
    source: 'snapshot',
    startedAt: null,
    endedAt: null,
    createdAt: T0,
    ...over,
  };
}

export function detail(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    session: session(),
    agents: [],
    findings: [],
    fileChanges: [],
    artifacts: [],
    links: [],
    gaps: [],
    domains: [],
    unfinished: [],
    sensitiveAccess: [],
    stats: stats(),
    lastAssistantMessage: null,
    ...over,
  };
}

/** The high-risk interrupted session from the detailed spec's sample report. */
export function highRiskDetail(): SessionDetail {
  return detail({
    session: session({
      status: 'interrupted',
      endReason: null,
      risk: 'high',
      subagentCount: 2,
      findingCount: 3,
      fileChangeCount: 3,
    }),
    agents: [subagent('b2', 'Plan', T0 + 5 * 60_000), subagent('a1', 'Explore', T0 + 2 * 60_000)],
    findings: [
      finding({
        ruleId: 'persistence.git_hook',
        severity: 'high',
        title: 'Git hook added',
        reason: 'A new pre-push hook will run on every push from this repository.',
        evidence: {
          eventIds: ['e7'],
          paths: [`${ROOT}/.git/hooks/pre-push`],
          artifactIds: [],
          note: null,
        },
        requested: false,
        ts: T0 + 8 * 60_000,
      }),
      finding({
        ruleId: 'persistence.ci',
        severity: 'high',
        title: 'CI workflow changed',
        reason: 'A GitHub Actions workflow changed, but the prompts did not ask for it.',
        evidence: {
          eventIds: ['e5', 'e6'],
          paths: [`${ROOT}/.github/workflows/deploy.yml`],
          artifactIds: [],
          note: null,
        },
        requested: false,
        ts: T0 + 6 * 60_000,
      }),
      finding({
        ruleId: 'secret.read',
        severity: 'medium',
        title: 'Secret file read',
        reason: 'The agent read an environment file that can hold credentials.',
        evidence: { eventIds: ['e3'], paths: [`${ROOT}/.env.test`], artifactIds: [], note: null },
        ts: T0 + 3 * 60_000,
      }),
      finding({
        ruleId: 'memory.note_written',
        severity: 'low',
        title: 'Memory note written',
        reason: 'NOTES.md changed and future sessions may load it.',
        ts: T0 + 9 * 60_000,
      }),
    ],
    fileChanges: [
      fileChange('src/auth/session.ts', { additions: 12, deletions: 3 }),
      fileChange('tests/auth/session.test.ts', { change: 'added', additions: 40, deletions: 0 }),
      fileChange('.github/workflows/deploy.yml', {
        classes: ['ci'],
        attribution: 'shell',
        additions: 2,
        deletions: 2,
      }),
    ],
    artifacts: [
      artifact({
        kind: 'memory_note',
        path: `${ROOT}/NOTES.md`,
        change: 'modified',
        detail: 'contains a next-step instruction',
      }),
      artifact({ kind: 'git_hook', path: `${ROOT}/.git/hooks/pre-push` }),
    ],
    links: [
      {
        sourceSessionId: SID,
        targetSessionId: '9c1e44d0-1111-2222-3333-444455556666',
        path: `${ROOT}/NOTES.md`,
        kind: 'note_loaded',
        eventId: 'x1',
        at: T0 + 60 * 60_000,
        direction: 'outgoing',
        otherSessionTitle: 'Write deployment notes',
      },
    ],
    domains: [
      {
        sessionId: SID,
        domain: 'registry.npmjs.org',
        firstEventId: 'e4',
        count: 3,
        isNew: false,
        via: ['npm'],
      },
      {
        sessionId: SID,
        domain: 'api.example.com',
        firstEventId: 'e8',
        count: 1,
        isNew: true,
        via: ['curl'],
      },
    ],
    unfinished: [{ kind: 'task', label: 'Deployment notes', eventId: 'e9' }],
    sensitiveAccess: [
      {
        path: `${ROOT}/.env.test`,
        op: 'read',
        eventId: 'e3',
        ts: T0 + 3 * 60_000,
        classes: ['secret'],
      },
      {
        path: `${ROOT}/.env.test`,
        op: 'read',
        eventId: 'e10',
        ts: T0 + 4 * 60_000,
        classes: ['secret'],
      },
    ],
    stats: stats({ subagents: 2 }),
    lastAssistantMessage:
      'I changed the login timeout and added tests.\nThe deployment notes are not done yet.',
  });
}

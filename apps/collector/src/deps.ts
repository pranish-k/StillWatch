/**
 * The collector core's dependencies on other packages, gathered in one object
 * so tests can replace any of them with fakes. `defaultDeps()` wires the real
 * implementations.
 */
import { adaptClaudeRecord, readTranscriptSummary } from '@stillwatch/adapter-claude';
import { extractFacts, persistenceSurface, repoSurfaceSpecs } from '@stillwatch/facts';
import { diffSnapshots, findRepoRoot, takeSnapshot } from '@stillwatch/git-tracker';
import { checkHookInstall } from '@stillwatch/installer';
import { createRedactor, truncateJson } from '@stillwatch/redaction';
import { summarizeSession } from '@stillwatch/reports';
import { analyzeSession, deriveSessionStatus } from '@stillwatch/rules';
import { installSqliteWarningFilter, openStore, type StoreOptions } from '@stillwatch/storage';
import { startHttpServer } from './server';

export type PipelineDeps = {
  adapt: typeof adaptClaudeRecord;
  createRedactor: typeof createRedactor;
  extractFacts: typeof extractFacts;
  truncateJson: typeof truncateJson;
  openStore: typeof openStore;
  takeSnapshot: typeof takeSnapshot;
  diffSnapshots: typeof diffSnapshots;
  findRepoRoot: typeof findRepoRoot;
  persistenceSurface: typeof persistenceSurface;
  repoSurfaceSpecs: typeof repoSurfaceSpecs;
  analyzeSession: typeof analyzeSession;
  deriveSessionStatus: typeof deriveSessionStatus;
  summarizeSession: typeof summarizeSession;
  readTranscriptSummary: typeof readTranscriptSummary;
  checkHookInstall: typeof checkHookInstall;
  startHttpServer: typeof startHttpServer;
};

export function defaultDeps(): PipelineDeps {
  return {
    adapt: adaptClaudeRecord,
    createRedactor,
    extractFacts,
    truncateJson,
    openStore: (options: StoreOptions) => {
      installSqliteWarningFilter();
      return openStore(options);
    },
    takeSnapshot,
    diffSnapshots,
    findRepoRoot,
    persistenceSurface,
    repoSurfaceSpecs,
    analyzeSession,
    deriveSessionStatus,
    summarizeSession,
    readTranscriptSummary,
    checkHookInstall,
    startHttpServer,
  };
}

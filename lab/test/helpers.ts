import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PipelineOptions } from '@stillwatch/collector';
import {
  createDefaultConfig,
  isRecord,
  stillwatchPaths,
  type Finding,
  type RuleId,
  type SessionDetail,
  type SessionRecord,
  type Severity,
} from '@stillwatch/schema';
import type { LabPipeline, RunnerDeps } from '../src/runner';
import type { World } from '../src/types';

/**
 * Test-only stand-in for the capture hook while `renderHookScript` is a
 * stub. It follows the same contract: mktemp in spool/tmp, rename into
 * spool/new, never write to stdout, always exit 0.
 */
export function minimalHookScript(stillwatchHome: string): string {
  return [
    '#!/bin/sh',
    `home='${stillwatchHome}'`,
    'case "$1" in ""|*[!a-z0-9-]*) exit 0;; esac',
    'case "$2" in ""|*[!A-Za-z0-9]*) exit 0;; esac',
    'f=$(mktemp "$home/spool/tmp/$1.$2.XXXXXXXXXX") || exit 0',
    'cat > "$f" || { rm -f "$f"; exit 0; }',
    'mv "$f" "$home/spool/new/" 2>/dev/null',
    'exit 0',
    '',
  ].join('\n');
}

export async function makeSpoolDirs(stillwatchHome: string): Promise<void> {
  const paths = stillwatchPaths(stillwatchHome);
  for (const dir of [paths.spoolTmp, paths.spoolNew, paths.bin]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
}

/** Paths only, for building scenario plans without touching the filesystem. */
export const FAKE_WORLD: World = {
  root: '/tmp/lab-world',
  home: '/tmp/lab-world/home',
  stillwatchHome: '/tmp/lab-world/home/.stillwatch',
  repo: '/tmp/lab-world/home/projects/demo-app',
  gitConfig: '/tmp/lab-world/gitconfig',
};

export type ImportedRecord = { file: string; payload: Record<string, unknown> };

export type FakeRun = {
  options: PipelineOptions;
  imported: ImportedRecord[];
  /** now() minus Date.now() at each sweep. */
  sweepOffsets: number[];
  analyzePendingCalls: number;
};

/**
 * Fake collector: imports spool records for real (reads and deletes them)
 * and reports findings chosen by `findings` per session id.
 */
export function fakeDeps(
  findings: (sessionId: string, run: FakeRun) => { ruleId: RuleId; severity: Severity }[],
  runs: FakeRun[] = [],
): RunnerDeps {
  return {
    renderHookScript: (o) => minimalHookScript(o.stillwatchHome),
    ensureDataDirs: makeSpoolDirs,
    loadOrCreateConfig: async (home, now) => {
      const config = createDefaultConfig(now ?? Date.now());
      await writeFile(stillwatchPaths(home).config, `${JSON.stringify(config, null, 2)}\n`, {
        mode: 0o600,
      });
      return config;
    },
    createPipeline: (options) => {
      const run: FakeRun = { options, imported: [], sweepOffsets: [], analyzePendingCalls: 0 };
      runs.push(run);
      const spoolNew = stillwatchPaths(options.stillwatchHome).spoolNew;
      const sessionIds = (): Set<string> =>
        new Set(run.imported.map((r) => String(r.payload.session_id)));
      const pipeline: LabPipeline = {
        importOnce: async () => {
          // Same order as the real importer: modification time (ns), then name.
          const entries = await Promise.all(
            (await readdir(spoolNew)).map(async (name) => ({
              name,
              mtimeNs: (await stat(join(spoolNew, name), { bigint: true })).mtimeNs,
            })),
          );
          entries.sort((a, b) =>
            a.mtimeNs !== b.mtimeNs ? (a.mtimeNs < b.mtimeNs ? -1 : 1) : a.name < b.name ? -1 : 1,
          );
          const names = entries.map((e) => e.name);
          for (const file of names) {
            const parsed: unknown = JSON.parse(await readFile(join(spoolNew, file), 'utf8'));
            if (!isRecord(parsed)) throw new Error('bad record');
            run.imported.push({ file, payload: parsed });
            await rm(join(spoolNew, file));
          }
          return {
            files: names.length,
            imported: names.length,
            duplicates: 0,
            failed: 0,
            snapshots: 0,
          };
        },
        analyzePending: () => {
          run.analyzePendingCalls += 1;
          return Promise.resolve([...sessionIds()]);
        },
        analyzeSession: () => Promise.resolve(),
        sweep: () => {
          run.sweepOffsets.push((options.now ?? Date.now)() - Date.now());
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
        store: {
          getSession: (id) => (sessionIds().has(id) ? ({ id } as unknown as SessionRecord) : null),
          getSessionDetail: (id) => {
            if (!sessionIds().has(id)) return null;
            const list: Finding[] = findings(id, run).map((f) => ({
              id: `${id}-${f.ruleId}`,
              sessionId: id,
              ruleId: f.ruleId,
              severity: f.severity,
              title: f.ruleId,
              reason: 'test',
              subject: 'test',
              evidence: { eventIds: [], paths: [], artifactIds: [], note: null },
              requested: null,
              ts: 0,
            }));
            return { findings: list } as unknown as SessionDetail;
          },
        },
      };
      return Promise.resolve(pipeline);
    },
  };
}

/**
 * Everything a command touches outside its own arguments. Commands take these
 * as injected dependencies so tests can use fakes; `defaultDeps` wires the
 * real process, filesystem, and packages.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import * as collector from '@stillwatch/collector';
import * as installer from '@stillwatch/installer';
import * as lab from '@stillwatch/lab';
import * as reports from '@stillwatch/reports';
import * as storage from '@stillwatch/storage';

export type CollectorApi = Pick<
  typeof collector,
  | 'resolveStillwatchHome'
  | 'ensureDataDirs'
  | 'loadOrCreateConfig'
  | 'readConfig'
  | 'saveConfig'
  | 'renderHookScript'
  | 'collectorStatus'
  | 'startCollector'
  | 'CollectorStartError'
  | 'stopCollector'
  | 'runCollector'
  | 'createLoginUrl'
>;

export type InstallerApi = Pick<
  typeof installer,
  | 'settingsPathFor'
  | 'planHookEntries'
  | 'addHooksToSettings'
  | 'removeHooksFromSettings'
  | 'installedEvents'
  | 'readSettingsFile'
  | 'writeSettingsFile'
  | 'backupSettingsFile'
  | 'detectClaudeVersion'
  | 'checkHookInstall'
>;

export type StorageApi = Pick<typeof storage, 'openStore' | 'installSqliteWarningFilter'>;
export type ReportsApi = Pick<typeof reports, 'buildSessionReport' | 'renderMarkdownReport'>;
export type LabApi = Pick<typeof lab, 'runLab' | 'renderScorecard' | 'listScenarios'>;

export type Output = { write(text: string): void; readonly isTTY: boolean };

export type CliDeps = {
  stdout: Output;
  stderr: Output;
  stdinIsTTY: boolean;
  /** Asks a question on the terminal and returns the answer. */
  prompt(question: string): Promise<string>;
  env: Record<string, string | undefined>;
  cwd: string;
  /** The user's home directory. */
  home: string;
  now(): number;
  sleep(ms: number): Promise<void>;
  platform: NodeJS.Platform;
  /** Node binary running the CLI. */
  execPath: string;
  /** The running CLI file (dist/stillwatch.mjs when bundled). */
  cliPath: string;
  collector: CollectorApi;
  installer: InstallerApi;
  storage: StorageApi;
  reports: ReportsApi;
  lab: LabApi;
  /** Opens a URL in the default browser. */
  openUrl(url: string): Promise<void>;
  /** Resolves with the signal name on SIGTERM or SIGINT. */
  waitForShutdown(): Promise<string>;
};

function processOutput(stream: NodeJS.WriteStream): Output {
  return {
    write: (text) => {
      stream.write(text);
    },
    get isTTY() {
      return stream.isTTY;
    },
  };
}

async function promptOnTerminal(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function openUrlWith(platform: NodeJS.Platform, url: string): Promise<void> {
  const command = platform === 'darwin' ? 'open' : platform === 'linux' ? 'xdg-open' : null;
  if (command === null) return Promise.reject(new Error(`no browser opener for ${platform}`));
  return new Promise((resolve, reject) => {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function waitForSignal(): Promise<string> {
  return new Promise((resolve) => {
    const onSignal = (signal: NodeJS.Signals): void => {
      process.off('SIGTERM', onSignal);
      process.off('SIGINT', onSignal);
      resolve(signal);
    };
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);
  });
}

export function defaultDeps(): CliDeps {
  return {
    stdout: processOutput(process.stdout),
    stderr: processOutput(process.stderr),
    stdinIsTTY: process.stdin.isTTY,
    prompt: promptOnTerminal,
    env: process.env,
    cwd: process.cwd(),
    home: homedir(),
    now: () => Date.now(),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    platform: process.platform,
    execPath: process.execPath,
    cliPath: fileURLToPath(import.meta.url),
    collector,
    installer,
    storage,
    reports,
    lab,
    openUrl: (url) => openUrlWith(process.platform, url),
    waitForShutdown: waitForSignal,
  };
}

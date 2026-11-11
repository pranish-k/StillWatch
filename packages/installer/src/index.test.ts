import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLAUDE_HOOK_EVENTS } from '@stillwatch/adapter-claude';
import { createDefaultConfig, type InstallRecord } from '@stillwatch/schema';
import {
  CREATED_HOOKS_OBJECT,
  SettingsParseError,
  addHooksToSettings,
  backupSettingsFile,
  checkHookInstall,
  detectClaudeVersion,
  installedEvents,
  outdatedEvents,
  planHookEntries,
  readSettingsFile,
  removeHooksFromSettings,
  settingsPathFor,
  writeSettingsFile,
} from './index';
import { compareVersionStrings, parseVersionOutput } from './version';

const SCRIPT = '/home/u/.stillwatch/bin/hook.sh';
const plan = planHookEntries({
  hookScript: SCRIPT,
  agent: 'claude-code',
  events: CLAUDE_HOOK_EVENTS,
});

const userSettings = {
  model: 'opus',
  permissions: { allow: ['Bash(ls)'] },
  hooks: {
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre', timeout: 5 }] },
    ],
    Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }],
    CustomUnknown: [{ hooks: [{ type: 'command', command: 'x' }] }],
  },
  env: { A: '1' },
};

function roundTrip(original: string | null): { installed: string; uninstalled: string } {
  const add = addHooksToSettings(original, plan);
  const removed = removeHooksFromSettings(add.text, SCRIPT, add.createdEventKeys);
  return { installed: add.text, uninstalled: removed.text };
}

describe('settingsPathFor', () => {
  const location = { home: '/h', projectDir: '/p', claudeConfigDir: null };
  it('resolves each scope', () => {
    expect(settingsPathFor('user', location)).toBe('/h/.claude/settings.json');
    expect(settingsPathFor('project', location)).toBe('/p/.claude/settings.json');
    expect(settingsPathFor('local', location)).toBe('/p/.claude/settings.local.json');
  });
  it('honors CLAUDE_CONFIG_DIR for user scope only', () => {
    const loc = { ...location, claudeConfigDir: '/cfg' };
    expect(settingsPathFor('user', loc)).toBe('/cfg/settings.json');
    expect(settingsPathFor('project', loc)).toBe('/p/.claude/settings.json');
  });
  it('needs a project directory for project scope', () => {
    expect(() => settingsPathFor('local', { ...location, projectDir: null })).toThrow(/project/);
  });
});

describe('planHookEntries', () => {
  it('follows the event spec', () => {
    expect(plan.map((p) => p.event)).toEqual(CLAUDE_HOOK_EVENTS.map((s) => s.event));
    const start = plan.find((p) => p.event === 'SessionStart');
    expect(start).toEqual({
      event: 'SessionStart',
      command: '/bin/sh',
      args: [SCRIPT, 'claude-code', 'SessionStart', '--ensure-collector'],
      async: false,
      timeoutSec: 10,
    });
    const pre = plan.find((p) => p.event === 'PreToolUse');
    expect(pre?.async).toBe(true);
    expect(pre?.args).toEqual([SCRIPT, 'claude-code', 'PreToolUse']);
    expect(plan.find((p) => p.event === 'SessionEnd')?.timeoutSec).toBeNull();
  });
  it('never sets a timeout on SessionEnd', () => {
    const [entry] = planHookEntries({
      hookScript: SCRIPT,
      agent: 'claude-code',
      events: [
        {
          event: 'SessionEnd',
          mode: 'sync',
          timeoutSec: 5,
          ensureCollector: false,
          description: '',
        },
      ],
    });
    expect(entry?.timeoutSec).toBeNull();
  });
});

describe('addHooksToSettings', () => {
  it('appends one group per event and preserves user settings', () => {
    const original = JSON.stringify(userSettings, null, 2);
    const result = addHooksToSettings(original, plan);
    expect(result.changed).toBe(true);
    expect(result.added).toHaveLength(plan.length);
    const parsed = JSON.parse(result.text);
    expect(Object.keys(parsed as object)).toEqual(['model', 'permissions', 'hooks', 'env']);
    expect(parsed.hooks.PreToolUse[0]).toEqual(userSettings.hooks.PreToolUse[0]);
    expect(parsed.hooks.PreToolUse[1]).toEqual({
      hooks: [
        {
          type: 'command',
          command: '/bin/sh',
          args: [SCRIPT, 'claude-code', 'PreToolUse'],
          async: true,
        },
      ],
    });
    expect(parsed.hooks.SessionEnd).toEqual([
      {
        hooks: [
          { type: 'command', command: '/bin/sh', args: [SCRIPT, 'claude-code', 'SessionEnd'] },
        ],
      },
    ]);
    expect(parsed.hooks.Stop[1].hooks[0]).toEqual({
      type: 'command',
      command: '/bin/sh',
      args: [SCRIPT, 'claude-code', 'Stop'],
      timeout: 10,
    });
    expect(result.createdEventKeys).not.toContain('PreToolUse');
    expect(result.createdEventKeys).not.toContain(CREATED_HOOKS_OBJECT);
    expect(result.createdEventKeys).toContain('SessionStart');
    expect(result.text.endsWith('}\n')).toBe(true);
    expect(result.text).toContain('\n  "model"');
  });

  it('is idempotent', () => {
    const first = addHooksToSettings(null, plan);
    const second = addHooksToSettings(first.text, plan);
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
    expect(second.added).toEqual([]);
    expect(second.alreadyPresent).toHaveLength(plan.length);
    expect(second.createdEventKeys).toEqual([]);
  });

  it('updates an outdated Stillwatch handler in place', () => {
    const old = {
      hooks: {
        Stop: [
          {
            hooks: [{ type: 'command', command: '/bin/sh', args: [SCRIPT, 'claude-code', 'Stop'] }],
          },
        ],
      },
    };
    const result = addHooksToSettings(JSON.stringify(old), plan);
    const parsed = JSON.parse(result.text);
    expect(parsed.hooks.Stop).toHaveLength(1);
    expect(parsed.hooks.Stop[0].hooks[0].timeout).toBe(10);
    expect(result.added).toContain('Stop');
  });

  it('creates settings from no file and from an empty file', () => {
    for (const input of [null, '', '  \n']) {
      const result = addHooksToSettings(input, plan);
      expect(result.createdEventKeys).toContain(CREATED_HOOKS_OBJECT);
      expect(Object.keys(JSON.parse(result.text) as object)).toEqual(['hooks']);
    }
  });

  it('refuses malformed JSON and wrong types', () => {
    expect(() => addHooksToSettings('{"hooks": ', plan)).toThrow(SettingsParseError);
    expect(() => addHooksToSettings('[]', plan)).toThrow(SettingsParseError);
    expect(() => addHooksToSettings('"x"', plan)).toThrow(SettingsParseError);
    expect(() => addHooksToSettings('{"hooks": []}', plan)).toThrow(SettingsParseError);
    expect(() => addHooksToSettings('{"hooks": null}', plan)).toThrow(SettingsParseError);
    expect(() => addHooksToSettings('{"hooks": {"Stop": {}}}', plan)).toThrow(SettingsParseError);
  });
});

describe('removeHooksFromSettings', () => {
  const cases: [string, string | null][] = [
    ['user hooks', JSON.stringify(userSettings, null, 2)],
    ['no file', null],
    ['empty file', ''],
    ['empty object', '{}'],
    ['empty hooks object', '{"hooks": {}}'],
    ['empty event arrays', '{"hooks": {"Stop": [], "PreToolUse": []}}'],
    ['only other keys', '{"theme": "dark"}'],
  ];
  it.each(cases)('restores the original exactly: %s', (_name, original) => {
    const { uninstalled } = roundTrip(original);
    const expected: unknown = original === null || original === '' ? {} : JSON.parse(original);
    expect(JSON.parse(uninstalled)).toStrictEqual(expected);
  });

  it('reports emptyAfter when nothing else is left', () => {
    const add = addHooksToSettings(null, plan);
    const result = removeHooksFromSettings(add.text, SCRIPT, add.createdEventKeys);
    expect(result.emptyAfter).toBe(true);
    expect(result.text).toBe('{}\n');
    expect(result.removed).toHaveLength(plan.length);
  });

  it('keeps event keys it did not create and user handlers added later', () => {
    const add = addHooksToSettings(null, plan);
    const parsed = JSON.parse(add.text) as { hooks: { Stop: unknown[] } };
    parsed.hooks.Stop.push({ hooks: [{ type: 'command', command: 'mine' }] });
    const result = removeHooksFromSettings(JSON.stringify(parsed), SCRIPT, add.createdEventKeys);
    expect(JSON.parse(result.text)).toEqual({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] },
    });
    const noCreated = removeHooksFromSettings(add.text, SCRIPT, []);
    expect(JSON.parse(noCreated.text).hooks.Stop).toEqual([]);
  });

  it('removes only handlers for this hook script', () => {
    const other = planHookEntries({
      hookScript: '/other/hook.sh',
      agent: 'claude-code',
      events: CLAUDE_HOOK_EVENTS,
    });
    const both = addHooksToSettings(addHooksToSettings(null, other).text, plan).text;
    const result = removeHooksFromSettings(both, SCRIPT, []);
    expect(installedEvents(result.text, '/other/hook.sh')).toHaveLength(plan.length);
    expect(installedEvents(result.text, SCRIPT)).toEqual([]);
  });

  it('leaves text untouched when nothing is installed', () => {
    const text = '{ "a":1 }';
    expect(removeHooksFromSettings(text, SCRIPT, [])).toEqual({
      text,
      changed: false,
      removed: [],
      emptyAfter: false,
    });
    expect(() => removeHooksFromSettings('{', SCRIPT, [])).toThrow(SettingsParseError);
  });
});

describe('installedEvents', () => {
  it('lists events with a Stillwatch handler', () => {
    expect(installedEvents(null, SCRIPT)).toEqual([]);
    const text = addHooksToSettings(JSON.stringify(userSettings), plan).text;
    expect(installedEvents(text, SCRIPT).sort()).toEqual(plan.map((p) => p.event).sort());
  });
});

describe('versions', () => {
  it('parses and compares', () => {
    expect(parseVersionOutput('2.1.318 (Claude Code)\n')).toBe('2.1.318');
    expect(parseVersionOutput('nothing')).toBeNull();
    expect(compareVersionStrings('2.1.318', '2.1.139')).toBe(1);
    expect(compareVersionStrings('2.1.100', '2.1.139')).toBe(-1);
    expect(compareVersionStrings('2.1.139', '2.1.139')).toBe(0);
    expect(compareVersionStrings('2.1.139-beta', '2.1.139')).toBe(-1);
  });
});

describe('files', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-installer-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads null for a missing file', async () => {
    expect(await readSettingsFile(join(dir, 'nope.json'))).toBeNull();
  });

  it('writes atomically with 0600 and a 0700 parent', async () => {
    const path = join(dir, 'cfg', '.claude', 'settings.json');
    await writeSettingsFile(path, '{}\n');
    expect(await readFile(path, 'utf8')).toBe('{}\n');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'cfg', '.claude'))).mode & 0o777).toBe(0o700);
    expect(await readdir(join(dir, 'cfg', '.claude'))).toEqual(['settings.json']);
  });

  it('keeps the existing mode and replaces the inode', async () => {
    const path = join(dir, 'settings.json');
    await writeFile(path, '{"a":1}');
    await chmod(path, 0o644);
    const before = await stat(path);
    await writeSettingsFile(path, '{"a":2}\n');
    const after = await stat(path);
    expect(after.mode & 0o777).toBe(0o644);
    expect(after.ino).not.toBe(before.ino);
    expect(await readFile(path, 'utf8')).toBe('{"a":2}\n');
    expect(await readdir(dir)).toEqual(['settings.json']);
  });

  it('writes through a symlink', async () => {
    const real = join(dir, 'real.json');
    const link = join(dir, 'settings.json');
    await writeFile(real, '{}');
    await symlink(real, link);
    await writeSettingsFile(link, '{"b":1}\n');
    expect(await readFile(real, 'utf8')).toBe('{"b":1}\n');
  });

  it('backs up with a timestamped 0600 copy', async () => {
    const path = join(dir, 'settings.json');
    const backups = join(dir, 'backups');
    expect(await backupSettingsFile(path, backups, 0)).toBeNull();
    await writeFile(path, '{"x":1}', { mode: 0o644 });
    const first = await backupSettingsFile(path, backups, Date.UTC(2026, 10, 5, 12));
    const second = await backupSettingsFile(path, backups, Date.UTC(2026, 10, 5, 12));
    expect(first).toBe(join(backups, 'settings.json.2026-11-05T12-00-00-000Z.bak'));
    expect(second).toBe(join(backups, 'settings.json.2026-11-05T12-00-00-000Z.1.bak'));
    expect(await readFile(first ?? '', 'utf8')).toBe('{"x":1}');
    expect((await stat(first ?? '')).mode & 0o777).toBe(0o600);
    expect((await stat(backups)).mode & 0o777).toBe(0o700);
  });

  it('detects the Claude Code version with a fake binary', async () => {
    const bin = join(dir, 'claude');
    await writeFile(bin, '#!/bin/sh\necho "2.1.318 (Claude Code)"\n', { mode: 0o755 });
    expect(await detectClaudeVersion({ claudeBinary: bin })).toBe('2.1.318');
    expect(await detectClaudeVersion({ claudeBinary: join(dir, 'missing') })).toBeNull();
  });

  it('checks an install', async () => {
    const home = join(dir, 'sw');
    const hookScript = join(home, 'bin', 'hook.sh');
    const settingsPath = join(dir, 'settings.json');
    const config = createDefaultConfig(0);
    expect(await checkHookInstall(config, { claudeVersion: null })).toMatchObject({
      installed: false,
      compatible: null,
      missing: CLAUDE_HOOK_EVENTS.map((s) => s.event),
    });
    const record: InstallRecord = {
      installedAt: 0,
      scope: 'user',
      settingsPath,
      settingsExisted: false,
      backupPath: null,
      events: [],
      hookScript,
      nodePath: '/usr/bin/node',
      cliPath: '/x/stillwatch.mjs',
      claudeVersion: null,
      stillwatchVersion: '0',
    };
    const installedConfig = { ...config, install: record };
    const partial = planHookEntries({
      hookScript,
      agent: 'claude-code',
      events: CLAUDE_HOOK_EVENTS.slice(0, 3),
    });
    await writeSettingsFile(settingsPath, addHooksToSettings(null, partial).text);
    await mkdir(join(home, 'bin'), { recursive: true });
    await writeFile(hookScript, `#!/bin/sh\nspool='${home}/spool'\n`);
    const status = await checkHookInstall(installedConfig, { claudeVersion: '2.1.318' });
    expect(status).toMatchObject({
      installed: true,
      scope: 'user',
      settingsPath,
      hookScriptOk: true,
      claudeVersion: '2.1.318',
      compatible: true,
    });
    expect(status.events).toEqual(CLAUDE_HOOK_EVENTS.slice(0, 3).map((s) => s.event));
    expect(status.missing).toHaveLength(CLAUDE_HOOK_EVENTS.length - 3);
    expect(status.outdated).toEqual([]);
    expect((await checkHookInstall(installedConfig, { claudeVersion: '2.1.100' })).compatible).toBe(
      false,
    );
    await writeFile(hookScript, 'echo nothing\n');
    expect((await checkHookInstall(installedConfig, { claudeVersion: null })).hookScriptOk).toBe(
      false,
    );
    await writeFile(settingsPath, '{broken');
    expect(await checkHookInstall(installedConfig, { claudeVersion: null })).toMatchObject({
      installed: false,
      events: [],
    });
  });
});

describe('outdatedEvents', () => {
  const hookScript = '/home/u/.stillwatch/bin/hook.sh';
  const plans = planHookEntries({ hookScript, agent: 'claude-code', events: CLAUDE_HOOK_EVENTS });

  it('lists nothing for hooks this version installed', () => {
    const text = addHooksToSettings(null, plans).text;
    expect(outdatedEvents(text, hookScript, plans)).toEqual([]);
  });

  it('lists events whose handler lacks --ensure-collector, as older versions wrote them', () => {
    const text = addHooksToSettings(null, plans).text.replaceAll(
      ',\n              "--ensure-collector"',
      '',
    );
    const ensured = CLAUDE_HOOK_EVENTS.filter((s) => s.ensureCollector).map((s) => s.event);
    expect(ensured.length).toBeGreaterThan(0);
    expect(outdatedEvents(text, hookScript, plans)).toEqual(ensured);
  });

  it('lists an event whose async flag changed, and ignores events with no handler', () => {
    const asyncPlan = plans.find((p) => p.async);
    if (asyncPlan === undefined) throw new Error('no async hook in the spec');
    const sync = { ...asyncPlan, async: false };
    const text = addHooksToSettings(null, [sync]).text;
    expect(outdatedEvents(text, hookScript, plans)).toEqual([asyncPlan.event]);
  });
});

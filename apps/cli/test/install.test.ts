import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, type CliDeps } from '../src/main';
import { stableNodePath } from '../src/runtime';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stillwatch-cli-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeFile(path: string, text: string, mode = 0o644): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  await chmod(path, mode);
  return path;
}

/** A fake bundled CLI: `dist/stillwatch.mjs` next to `dist/web/index.html`. */
async function makeBundle(dist: string, version: string): Promise<string> {
  await makeFile(join(dist, 'web', 'index.html'), `<!doctype html><title>${version}</title>`);
  return makeFile(join(dist, 'stillwatch.mjs'), `// stillwatch ${version}\n`, 0o755);
}

type Run = { code: number; out: string; err: string };

function paths() {
  const home = join(root, 'home');
  const swHome = join(home, '.stillwatch');
  return {
    home,
    swHome,
    app: join(swHome, 'app'),
    hookScript: join(swHome, 'bin', 'hook.sh'),
    config: join(swHome, 'config.json'),
    settings: join(home, '.claude', 'settings.json'),
  };
}

async function run(
  args: string[],
  deps: { cliPath: string; execPath?: string; path?: string },
): Promise<Run> {
  const p = paths();
  await mkdir(p.home, { recursive: true });
  let out = '';
  let err = '';
  const overrides: Partial<CliDeps> = {
    stdout: { write: (text) => (out += text), isTTY: false },
    stderr: { write: (text) => (err += text), isTTY: false },
    stdinIsTTY: false,
    env: { HOME: p.home, STILLWATCH_HOME: p.swHome, PATH: deps.path ?? join(root, 'empty-bin') },
    home: p.home,
    cwd: p.home,
    execPath: deps.execPath ?? process.execPath,
    cliPath: deps.cliPath,
  };
  const code = await main(args, overrides);
  return { code, out, err };
}

async function installRecord(): Promise<{ cliPath: string; nodePath: string }> {
  const config = JSON.parse(await readFile(paths().config, 'utf8')) as {
    install: { cliPath: string; nodePath: string };
  };
  return config.install;
}

const NPX_DIST = ['npm-cache', '_npx', 'a1b2c3', 'node_modules', 'stillwatch', 'dist'];

describe('install from a temporary npm cache', () => {
  it('copies the app into the Stillwatch home and points the hook at the copy', async () => {
    const cache = join(root, ...NPX_DIST);
    const cliPath = await makeBundle(cache, '0.1.0');
    const result = await run(['install', '--no-start'], { cliPath });
    expect(result.code).toBe(0);

    const p = paths();
    const copied = join(p.app, 'stillwatch.mjs');
    expect(await readFile(copied, 'utf8')).toBe('// stillwatch 0.1.0\n');
    expect(await readFile(join(p.app, 'web', 'index.html'), 'utf8')).toContain('0.1.0');
    expect((await installRecord()).cliPath).toBe(copied);
    const hook = await readFile(p.hookScript, 'utf8');
    expect(hook).toContain(`'${copied}' start --quiet`);
    expect(hook).not.toContain('_npx');
    expect(result.out).toMatch(/App\s+~\/\.stillwatch\/app \(copied from the npm cache\)/);
    expect(result.err).not.toContain('npm may clean up');

    // npm cleaning its cache must not break the hook.
    await rm(join(root, 'npm-cache'), { recursive: true });
    expect(await readFile(copied, 'utf8')).toBe('// stillwatch 0.1.0\n');
  });

  it('replaces an earlier copy and leaves no temporary entries behind', async () => {
    await run(['install', '--no-start'], {
      cliPath: await makeBundle(join(root, ...NPX_DIST), '0.1.0'),
    });
    const newer = await makeBundle(
      join(root, 'npm-cache', '_npx', 'ffff', 'node_modules', 'stillwatch', 'dist'),
      '0.2.0',
    );
    const result = await run(['install', '--no-start'], { cliPath: newer });
    expect(result.code).toBe(0);

    const p = paths();
    expect(await readFile(join(p.app, 'stillwatch.mjs'), 'utf8')).toBe('// stillwatch 0.2.0\n');
    expect(await readFile(join(p.app, 'web', 'index.html'), 'utf8')).toContain('0.2.0');
    const leftovers = (await readdir(p.swHome)).filter((name) => name.startsWith('.app.'));
    expect(leftovers).toEqual([]);
  });

  it('treats pnpm dlx like npx', async () => {
    const cliPath = await makeBundle(
      join(root, 'Caches', 'pnpm', 'dlx', 'x1', 'node_modules', 'stillwatch', 'dist'),
      '0.1.0',
    );
    await run(['install', '--no-start'], { cliPath });
    expect((await installRecord()).cliPath).toBe(join(paths().app, 'stillwatch.mjs'));
  });

  it('shows the copy in a dry run without making it', async () => {
    const cliPath = await makeBundle(join(root, ...NPX_DIST), '0.1.0');
    const result = await run(['install', '--dry-run'], { cliPath });
    expect(result.code).toBe(0);
    expect(result.out).toContain('App copy:');
    await expect(readdir(paths().app)).rejects.toThrow();
  });

  it('removes the copy on uninstall --purge', async () => {
    const cliPath = await makeBundle(join(root, ...NPX_DIST), '0.1.0');
    await run(['install', '--no-start'], { cliPath });
    const result = await run(['uninstall', '--purge', '--yes'], { cliPath });
    expect(result.code).toBe(0);
    await expect(readdir(paths().swHome)).rejects.toThrow();
  });
});

describe('install from a global or source install', () => {
  it('runs the CLI from where it is installed and makes no copy', async () => {
    const cliPath = await makeBundle(
      join(root, 'prefix', 'lib', 'node_modules', 'stillwatch', 'dist'),
      '0.1.0',
    );
    const result = await run(['install', '--no-start'], { cliPath });
    expect(result.code).toBe(0);
    expect((await installRecord()).cliPath).toBe(cliPath);
    expect(await readFile(paths().hookScript, 'utf8')).toContain(`'${cliPath}' start --quiet`);
    expect(result.out).not.toContain('App ');
    await expect(readdir(paths().app)).rejects.toThrow();
  });
});

describe('the Node path the hook uses', () => {
  async function homebrewLayout(): Promise<{ cellarNode: string; binDir: string }> {
    const cellarNode = await makeFile(
      join(root, 'brew', 'Cellar', 'node', '25.5.0', 'bin', 'node'),
      '#!/bin/sh\n',
      0o755,
    );
    const binDir = join(root, 'brew', 'bin');
    await mkdir(binDir, { recursive: true });
    await symlink(cellarNode, join(binDir, 'node'));
    return { cellarNode, binDir };
  }

  it('stores the PATH entry instead of a versioned Homebrew path', async () => {
    const { cellarNode, binDir } = await homebrewLayout();
    const cliPath = await makeBundle(join(root, 'global', 'dist'), '0.1.0');
    await run(['install', '--no-start'], { cliPath, execPath: cellarNode, path: binDir });
    const stable = join(binDir, 'node');
    expect((await installRecord()).nodePath).toBe(stable);
    expect(await readFile(paths().hookScript, 'utf8')).toContain(`'${stable}' '${cliPath}'`);
  });

  it('keeps the running Node when the node on PATH is a different binary', async () => {
    const { cellarNode } = await homebrewLayout();
    const other = await makeFile(join(root, 'other', 'bin', 'node'), '#!/bin/sh\n', 0o755);
    expect(await stableNodePath(cellarNode, dirname(other))).toBe(cellarNode);
  });

  it('keeps the running Node when it is already the one on PATH', async () => {
    const node = await makeFile(join(root, 'usr', 'bin', 'node'), '#!/bin/sh\n', 0o755);
    expect(await stableNodePath(node, dirname(node))).toBe(node);
  });

  it('keeps the running Node when no node is on PATH', async () => {
    expect(await stableNodePath('/opt/node/bin/node', undefined)).toBe('/opt/node/bin/node');
  });
});

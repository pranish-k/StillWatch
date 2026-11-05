import { describe, expect, it } from 'vitest';
import {
  baseName,
  canonicalJson,
  canonicalPath,
  displayPath,
  findRedactionMarkers,
  isWithin,
  maxSeverity,
  newId,
  pathKey,
  randomToken,
  redactionMarker,
  relativeTo,
  resolvePath,
  riskRank,
  stillwatchPaths,
  toJsonValue,
} from './index';

describe('canonicalJson', () => {
  it('sorts keys and is stable', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: { z: 1, y: 2 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}',
    );
  });
  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
  });
});

describe('toJsonValue', () => {
  it('drops non-JSON values and caps depth', () => {
    const deep: unknown[] = [];
    let cur = deep;
    for (let i = 0; i < 100; i++) {
      const next: unknown[] = [];
      cur.push(next);
      cur = next;
    }
    const out = JSON.stringify(toJsonValue({ a: undefined, b: () => 1, c: Infinity, d: deep }, 5));
    expect(out).toContain('"c":null');
    expect(out).toContain('[depth limit]');
    expect(out).not.toContain('"a"');
  });
});

describe('paths', () => {
  it('normalizes lexically', () => {
    expect(canonicalPath('/a//b/./c/../d/')).toBe('/a/b/d');
    expect(canonicalPath('/..')).toBe('/');
    expect(canonicalPath('a/../../b')).toBe('../b');
  });
  it('folds macOS /private aliases only in keys', () => {
    expect(canonicalPath('/private/tmp/x')).toBe('/private/tmp/x');
    expect(pathKey('/private/tmp/x')).toBe('/tmp/x');
    expect(pathKey('/tmp/x')).toBe('/tmp/x');
    expect(isWithin('/private/var/folders/a', '/var/folders')).toBe(true);
  });
  it('resolves home and relative paths', () => {
    expect(resolvePath('/repo', '~/.zshrc', '/Users/dev')).toBe('/Users/dev/.zshrc');
    expect(resolvePath('/repo', '$HOME/.ssh/id_rsa', '/Users/dev')).toBe('/Users/dev/.ssh/id_rsa');
    expect(resolvePath('/repo/src', '../.env', '/Users/dev')).toBe('/repo/.env');
  });
  it('computes relative and display paths', () => {
    expect(relativeTo('/repo/src/a.ts', '/repo')).toBe('src/a.ts');
    expect(relativeTo('/other/a.ts', '/repo')).toBeNull();
    expect(relativeTo('/repository/a', '/repo')).toBeNull();
    expect(displayPath('/Users/dev/.zshrc', '/repo', '/Users/dev')).toBe('~/.zshrc');
    expect(baseName('/a/b/c.txt')).toBe('c.txt');
  });
});

describe('ids', () => {
  it('creates sortable unique ids', () => {
    const a = newId(1_000);
    const b = newId(2_000);
    expect(a).toHaveLength(26);
    expect(a < b).toBe(true);
    expect(newId(1_000)).not.toBe(a);
    expect(randomToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('redaction markers', () => {
  it('round trips', () => {
    const text = `curl -H "Authorization: ${redactionMarker('bearer-token', 'abcdef0123456789')}" x`;
    expect(findRedactionMarkers(text)).toEqual([
      { detector: 'bearer-token', fingerprint: 'abcdef01', index: text.indexOf('[REDACTED') },
    ]);
  });
});

describe('severity helpers', () => {
  it('ranks', () => {
    expect(maxSeverity(['low', 'high', 'medium'])).toBe('high');
    expect(maxSeverity([])).toBeNull();
    expect(riskRank('unknown')).toBeGreaterThan(riskRank('low'));
    expect(riskRank('medium')).toBeGreaterThan(riskRank('unknown'));
  });
});

describe('stillwatchPaths', () => {
  it('lays out the data directory', () => {
    const p = stillwatchPaths('/Users/dev/.stillwatch/');
    expect(p.db).toBe('/Users/dev/.stillwatch/stillwatch.db');
    expect(p.spoolNew).toBe('/Users/dev/.stillwatch/spool/new');
    expect(p.hookScript).toBe('/Users/dev/.stillwatch/bin/hook.sh');
  });
});

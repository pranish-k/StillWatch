import { describe, expect, it } from 'vitest';
import { parseShell } from '../src/index';
import { CWD, HOME, shellFacts } from './helpers';

describe('parser performance', () => {
  it('parses hostile nesting in linear time', () => {
    const deep = '$('.repeat(5_000) + ')'.repeat(5_000);
    const wide = 'a | '.repeat(15_000) + 'b';
    const start = performance.now();
    parseShell(deep, CWD, HOME);
    shellFacts(wide);
    expect(performance.now() - start).toBeLessThan(2_000);
  });
});

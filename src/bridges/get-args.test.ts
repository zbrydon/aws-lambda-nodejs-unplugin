import { describe, it, expect, vi, afterEach } from 'vitest';
import { getArgs } from './get-args.ts';

describe('getArgs', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('parses valid arguments', () => {
    process.argv = ['node', 'script.js', '/config.json', 'src/index.ts', 'dist'];

    expect(getArgs()).toEqual({
      configPath: '/config.json',
      entry: 'src/index.ts',
      outputDir: 'dist',
    });
  });

  it('throws when required arguments are missing', () => {
    process.argv = ['node', 'script.js'];

    expect(() => getArgs()).toThrow('Invalid input');
  });
});

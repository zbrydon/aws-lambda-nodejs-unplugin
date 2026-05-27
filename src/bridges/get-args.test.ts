import { describe, it, expect, vi, afterEach } from 'vitest';
import { getArgs } from './get-args.ts';

describe('getArgs', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('parses valid arguments', () => {
    process.argv = ['node', 'script.js', '/config.json', 'src/index.ts', 'dist', '["react","zod"]'];

    expect(getArgs()).toEqual({
      configPath: '/config.json',
      entry: 'src/index.ts',
      outputDir: 'dist',
      nodeModules: ['react', 'zod'],
    });
  });

  it('throws when required arguments are missing', () => {
    process.argv = ['node', 'script.js'];

    expect(() => getArgs()).toThrow('Invalid input');
  });

  it('throws when nodeModulesJson is invalid JSON', () => {
    process.argv = ['node', 'script.js', '/config.json', 'src/index.ts', 'dist', 'not-json'];

    expect(() => getArgs()).toThrow(`Unexpected token 'o', "not-json" is not valid JSON`);
  });

  it('throws when nodeModulesJson is not an array of strings', () => {
    process.argv = ['node', 'script.js', '/config.json', 'src/index.ts', 'dist', '[1,2,3]'];

    expect(() => getArgs()).toThrow('Invalid input');
  });
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertSingleEntryFile, rejectSplittingOption } from './guard.ts';

describe('rejectSplittingOption', () => {
  it.each([undefined, null, false, {}, []])('allows the disabled value %p', (value) => {
    expect(() => rejectSplittingOption(value, 'opt')).not.toThrow();
  });

  it.each([true, 'all', { vendors: true }, ['a']])('rejects the configured value %p', (value) => {
    expect(() => rejectSplittingOption(value, 'opt.manualChunks')).toThrow(/opt.manualChunks/);
  });
});

describe('assertSingleEntryFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('passes for a single CJS entry (no format)', () => {
    fs.writeFileSync(path.join(dir, 'index.js'), '');
    fs.writeFileSync(path.join(dir, '.lambda-bundle-meta'), '{}');
    expect(() => assertSingleEntryFile(dir, undefined)).not.toThrow();
  });

  it('passes for a single ESM entry', () => {
    fs.writeFileSync(path.join(dir, 'index.mjs'), '');
    expect(() => assertSingleEntryFile(dir, 'esm')).not.toThrow();
  });

  it('throws when an extra chunk file is emitted alongside the entry', () => {
    fs.writeFileSync(path.join(dir, 'index.js'), '');
    fs.writeFileSync(path.join(dir, 'chunk-abc123.js'), '');
    expect(() => assertSingleEntryFile(dir, undefined)).toThrow(/chunk-abc123\.js/);
  });
});

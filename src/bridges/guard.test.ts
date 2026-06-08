import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertEntryFileEmitted,
  rejectRollupStyleSplitting,
  rejectSplitChunks,
  rejectSplittingOption,
} from './guard.ts';

describe('rejectSplittingOption', () => {
  it.each([undefined, null, false, {}, []])('allows the disabled value %p', (value) => {
    expect(() => rejectSplittingOption(value, 'opt')).not.toThrow();
  });

  it.each([true, 'all', { vendors: true }, ['a']])('rejects the configured value %p', (value) => {
    expect(() => rejectSplittingOption(value, 'opt.manualChunks')).toThrow(/opt.manualChunks/);
  });
});

describe('rejectSplitChunks', () => {
  it.each([undefined, null, false, {}, { chunks: 'async' }, { cacheGroups: {} }])(
    'allows the benign value %p',
    (value) => {
      expect(() => rejectSplitChunks(value, 'opt.splitChunks')).not.toThrow();
    },
  );

  it.each([
    { chunks: 'all' },
    { chunks: 'initial' },
    { cacheGroups: { vendors: { chunks: 'all' } } },
  ])('rejects the entry-splitting value %p', (value) => {
    expect(() => rejectSplitChunks(value, 'opt.splitChunks')).toThrow(/opt.splitChunks/);
  });
});

describe('rejectRollupStyleSplitting', () => {
  it('throws for multiple outputs', () => {
    expect(() => rejectRollupStyleSplitting([{}, {}], undefined)).toThrow(
      /Multiple Rollup\/Rolldown outputs/,
    );
  });

  it('uses the provided label for multiple outputs', () => {
    expect(() => rejectRollupStyleSplitting([{}, {}], undefined, 'Vite')).toThrow(
      /Multiple Vite outputs/,
    );
  });

  it.each([undefined, [], [{}]])('allows the benign rawOutput %p', (rawOutput) => {
    expect(() => rejectRollupStyleSplitting(rawOutput, undefined)).not.toThrow();
  });

  it('rejects manualChunks on the base output', () => {
    expect(() =>
      rejectRollupStyleSplitting(undefined, { manualChunks: { vendor: ['a'] } }),
    ).toThrow(/output\.manualChunks/);
  });

  it('rejects preserveModules on the base output', () => {
    expect(() => rejectRollupStyleSplitting(undefined, { preserveModules: true })).toThrow(
      /output\.preserveModules/,
    );
  });

  it('allows a base output without splitting options', () => {
    expect(() => rejectRollupStyleSplitting(undefined, { dir: 'out' })).not.toThrow();
  });
});

describe('assertEntryFileEmitted', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('passes for a CJS entry (no format)', () => {
    fs.writeFileSync(path.join(dir, 'index.js'), '');
    fs.writeFileSync(path.join(dir, '.lambda-bundle-meta'), '{}');
    expect(() => assertEntryFileEmitted(dir, undefined)).not.toThrow();
  });

  it('passes for an ESM entry', () => {
    fs.writeFileSync(path.join(dir, 'index.mjs'), '');
    expect(() => assertEntryFileEmitted(dir, 'esm')).not.toThrow();
  });

  it('allows secondary chunks alongside the entry', () => {
    fs.writeFileSync(path.join(dir, 'index.mjs'), '');
    fs.writeFileSync(path.join(dir, 'chunk-abc123.js'), '');
    expect(() => assertEntryFileEmitted(dir, 'esm')).not.toThrow();
  });

  it('throws when the entry file is missing', () => {
    fs.writeFileSync(path.join(dir, 'chunk-abc123.js'), '');
    expect(() => assertEntryFileEmitted(dir, 'esm')).toThrow(/index\.mjs/);
  });
});

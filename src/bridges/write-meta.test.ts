import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entryFileName, isEsmFormat, writeBundleMeta } from './write-meta.ts';

describe('isEsmFormat', () => {
  it.each(['esm', 'es'])('returns true for ESM format %p', (format) => {
    expect(isEsmFormat(format)).toBe(true);
  });

  it.each(['cjs', 'iife', 'umd', undefined])('returns false for non-ESM format %p', (format) => {
    expect(isEsmFormat(format)).toBe(false);
  });
});

describe('entryFileName', () => {
  it.each(['esm', 'es'])('uses index.mjs for ESM format %p', (format) => {
    expect(entryFileName(format)).toBe('index.mjs');
  });

  it.each(['cjs', undefined])('uses index.js for non-ESM format %p', (format) => {
    expect(entryFileName(format)).toBe('index.js');
  });
});

describe('writeBundleMeta', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-meta-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes format to .lambda-bundle-meta', () => {
    writeBundleMeta(tmpDir, 'esm');

    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, '.lambda-bundle-meta'), 'utf-8'));
    expect(content).toEqual({ format: 'esm' });
  });

  it('writes null when format is undefined', () => {
    writeBundleMeta(tmpDir, undefined);

    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, '.lambda-bundle-meta'), 'utf-8'));
    expect(content).toEqual({ format: null });
  });
});

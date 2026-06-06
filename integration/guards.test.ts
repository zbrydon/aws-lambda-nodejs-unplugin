import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';
import { Bundling } from '../src/bundling.ts';
import { BASE_BUNDLING_PROPS } from './test-utils.ts';

/**
 * End-to-end coverage for the single-file / no-code-splitting guards in the
 * bundler bridges (which run in spawned subprocesses and are excluded from unit
 * coverage). Each case bundles a real config and asserts the bridge's behavior.
 */
const bundle = (overrides: Record<string, unknown>, outputDir: string): boolean =>
  new Bundling({
    ...BASE_BUNDLING_PROPS,
    entry: path.resolve('integration/fixtures/handler.ts'),
    ...overrides,
  } as ConstructorParameters<typeof Bundling>[0]).local.tryBundle(outputDir, {
    image: cdk.DockerImage.fromRegistry('dummy'),
  });

describe('single-file guards', () => {
  it('rejects esbuild code splitting', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-esbuild-'));
    try {
      expect(() =>
        bundle(
          {
            bundler: 'esbuild',
            bundlerConfig: path.resolve('integration/fixtures/esbuild-splitting.config.mjs'),
          },
          outputDir,
        ),
      ).toThrow(/splitting/);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects farm partialBundling groups', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-farm-'));
    try {
      expect(() =>
        bundle(
          {
            bundler: 'farm',
            bundlerConfig: path.resolve('integration/fixtures/farm-splitting.config.mjs'),
          },
          outputDir,
        ),
      ).toThrow(/not supported/);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects rollup multi-output configs', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-roll-multi-'));
    try {
      expect(() =>
        bundle(
          {
            bundler: 'rollup',
            bundlerConfig: path.resolve('integration/fixtures/rollup-multi-output.config.mjs'),
          },
          outputDir,
        ),
      ).toThrow(/Multiple/);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('accepts an empty rollup output and emits a single ESM handler', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-roll-empty-'));
    try {
      expect(
        bundle(
          {
            bundler: 'rollup',
            bundlerConfig: path.resolve('integration/fixtures/rollup-empty-output.config.mjs'),
          },
          outputDir,
        ),
      ).toBe(true);
      // Empty output -> format defaults to 'es' -> single index.mjs.
      expect(fs.existsSync(path.join(outputDir, 'index.mjs'))).toBe(true);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60_000);
});

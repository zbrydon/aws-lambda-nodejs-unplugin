import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as aws_lambda from 'aws-cdk-lib/aws-lambda';
import { expect, it } from 'vitest';
import { Bundling } from '../src/bundling.ts';
import { ValidationError } from '../src/errors.ts';

/**
 * Integration tests for commandHooks. Each test runs a real shell command and
 * verifies its side-effect on the filesystem. A single fast bundler (esbuild)
 * is used since hook behaviour is bundler-agnostic.
 */

const baseBundlingProps = {
  bundler: 'esbuild' as const,
  bundlerConfig: path.resolve('src/testing/fixtures/esbuild.config.mjs'),
  entry: path.resolve('src/testing/fixtures/handler.ts'),
  runtime: aws_lambda.Runtime.NODEJS_24_X,
  architecture: aws_lambda.Architecture.ARM_64,
  depsLockFilePath: path.resolve('pnpm-lock.yaml'),
  projectRoot: path.resolve('.'),
};

it('beforeBundling hook runs before the bundle is produced', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-hooks-before-'));
  try {
    const bundling = new Bundling({
      ...baseBundlingProps,
      commandHooks: {
        beforeBundling: (_inputDir, outDir) => [
          `touch ${path.join(outDir, 'before-sentinel.txt')}`,
        ],
        afterBundling: () => [],
        beforeInstall: () => [],
      },
    });

    expect(
      bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
    ).toBe(true);

    expect(
      fs.existsSync(path.join(outputDir, 'before-sentinel.txt')),
      'beforeBundling sentinel file should exist after tryBundle',
    ).toBe(true);
    expect(
      fs.existsSync(path.join(outputDir, 'index.js')),
      'bundle should still be produced when beforeBundling hook is set',
    ).toBe(true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}, 60_000);

it('afterBundling hook runs after the bundle is produced', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-hooks-after-'));
  try {
    const bundling = new Bundling({
      ...baseBundlingProps,
      commandHooks: {
        beforeBundling: () => [],
        // The hook reads index.js to confirm the bundler ran first, then writes a sentinel.
        afterBundling: (_inputDir, outDir) => [
          `test -f ${path.join(outDir, 'index.js')} && touch ${path.join(outDir, 'after-sentinel.txt')}`,
        ],
        beforeInstall: () => [],
      },
    });

    expect(
      bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
    ).toBe(true);

    expect(
      fs.existsSync(path.join(outputDir, 'after-sentinel.txt')),
      'afterBundling sentinel should exist, confirming the hook ran after index.js was produced',
    ).toBe(true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}, 60_000);

it('a failing beforeBundling hook throws ValidationError with the command in the message', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-hooks-fail-'));
  try {
    const failingCommand = 'exit 42';
    const bundling = new Bundling({
      ...baseBundlingProps,
      commandHooks: {
        beforeBundling: () => [failingCommand],
        afterBundling: () => [],
        beforeInstall: () => [],
      },
    });

    expect(() =>
      bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
    ).toThrowError(ValidationError);

    expect(() =>
      bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
    ).toThrowError(failingCommand);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

it('a failing afterBundling hook throws ValidationError', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-hooks-fail-after-'));
  try {
    const bundling = new Bundling({
      ...baseBundlingProps,
      commandHooks: {
        beforeBundling: () => [],
        afterBundling: () => ['exit 1'],
        beforeInstall: () => [],
      },
    });

    expect(() =>
      bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
    ).toThrowError(ValidationError);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

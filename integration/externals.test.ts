import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as aws_lambda from 'aws-cdk-lib/aws-lambda';
import { expect, it } from 'vitest';
import { Bundling } from '../src/bundling.ts';
import { SUPPORTED_BUNDLERS } from '../src/types.ts';

/**
 * Integration tests that verify `nodeModules` are correctly excluded from the
 * bundle and installed separately in the Lambda output directory.
 *
 * For each bundler we:
 *   1. Bundle `handler-with-dep.ts` (which imports `zod`) with
 *      `nodeModules: ['zod']`.
 *   2. Assert that `zod` is referenced externally in the bundle (i.e. a
 *      `require("zod")` call, not inlined code).
 *   3. Assert that `zod` was installed into `node_modules` in the output
 *      directory by the CDK bundling step.
 *   4. Load the bundle and invoke the handler to confirm the external module
 *      resolves correctly at runtime.
 */
/**
 * T6: multiple packages in nodeModules — verifies that the multi-package
 * install path works end-to-end. Uses esbuild with two separate packages.
 * (zod provides both 'zod' and 'zod' — use rollup as the second package since
 * it is already installed in the project devDependencies.)
 */
it('installs multiple nodeModules packages for esbuild', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-multi-externals-'));
  try {
    const bundling = new Bundling({
      bundler: 'esbuild',
      bundlerConfig: path.resolve('src/testing/fixtures/esbuild.config.mjs'),
      entry: path.resolve('src/testing/fixtures/handler-with-dep.ts'),
      runtime: aws_lambda.Runtime.NODEJS_24_X,
      architecture: aws_lambda.Architecture.ARM_64,
      depsLockFilePath: path.resolve('pnpm-lock.yaml'),
      projectRoot: path.resolve('.'),
      nodeModules: ['zod', 'rollup'],
    });

    expect(
      bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
    ).toBe(true);

    const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(outPkg.dependencies).toHaveProperty('zod');
    expect(outPkg.dependencies).toHaveProperty('rollup');
    expect(fs.existsSync(path.join(outputDir, 'node_modules', 'zod')), 'zod not installed').toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(outputDir, 'node_modules', 'rollup')),
      'rollup not installed',
    ).toBe(true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}, 120_000);

/**
 * T3: webpack and rspack ESM externals — verifies that the ESM external path
 * (output.module: true) installs nodeModules and the handler resolves them.
 */
it.each(['webpack', 'rspack'] as const)(
  'excludes nodeModules from ESM bundle and installs them for bundler: %s',
  async (bundler) => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `lambda-esm-ext-${bundler}-`));
    try {
      const bundling = new Bundling({
        bundler,
        bundlerConfig: path.resolve(`src/testing/fixtures/${bundler}-esm.config.mjs`),
        entry: path.resolve('src/testing/fixtures/handler-with-dep.ts'),
        runtime: aws_lambda.Runtime.NODEJS_24_X,
        architecture: aws_lambda.Architecture.ARM_64,
        depsLockFilePath: path.resolve('pnpm-lock.yaml'),
        projectRoot: path.resolve('.'),
        nodeModules: ['zod'],
      });

      expect(
        bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
      ).toBe(true);

      const indexPath = path.join(outputDir, 'index.js');
      expect(fs.existsSync(indexPath), `index.js missing in ${outputDir}`).toBe(true);

      const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8')) as {
        type?: string;
        dependencies?: Record<string, string>;
      };
      expect(outPkg.type, 'package.json must have type:module').toBe('module');
      expect(outPkg.dependencies, 'package.json must list zod').toHaveProperty('zod');

      expect(
        fs.existsSync(path.join(outputDir, 'node_modules', 'zod')),
        `zod not installed for ${bundler}`,
      ).toBe(true);

      const mod = (await import(pathToFileURL(indexPath).href)) as { handler?: unknown };
      expect(typeof mod.handler, 'handler should be a function').toBe('function');
      const result = (await (mod.handler as (e: unknown) => Promise<unknown>)({ bundler })) as {
        zodExports: string[];
      };
      expect(result.zodExports).toContain('z');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  },
  120_000,
);

/**
 * T4: Farm output filename enforcement — verifies that the bridge enforces
 * entryFilename: '[entryName].js' so index.js is always produced even if the
 * user config omits or overrides entryFilename.
 */
it('Farm bridge enforces index.js output filename regardless of user entryFilename', async () => {
  // Write a temp farm config that deliberately omits entryFilename.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-no-entryfilename-'));
  const configPath = path.join(tmpDir, 'farm-no-entry.config.mjs');
  fs.writeFileSync(
    configPath,
    `export default {
  compilation: {
    output: {
      format: 'cjs',
      targetEnv: 'node',
      // entryFilename intentionally omitted
    },
    external: ['^node:.*'],
    sourcemap: false,
    minify: false,
    persistentCache: false,
  },
};
`,
  );

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-entryfilename-out-'));
  try {
    const bundling = new Bundling({
      bundler: 'farm',
      bundlerConfig: configPath,
      entry: path.resolve('src/testing/fixtures/handler.ts'),
      runtime: aws_lambda.Runtime.NODEJS_24_X,
      architecture: aws_lambda.Architecture.ARM_64,
      depsLockFilePath: path.resolve('pnpm-lock.yaml'),
      projectRoot: path.resolve('.'),
    });

    expect(
      bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
    ).toBe(true);

    expect(
      fs.existsSync(path.join(outputDir, 'index.js')),
      'index.js missing — bridge must enforce entryFilename',
    ).toBe(true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}, 60_000);

it.each(SUPPORTED_BUNDLERS)(
  'excludes nodeModules from bundle and installs them in the output dir for bundler: %s',
  async (bundler) => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `lambda-externals-${bundler}-`));
    try {
      const bundling = new Bundling({
        bundler,
        bundlerConfig: path.resolve(`src/testing/fixtures/${bundler}.config.mjs`),
        entry: path.resolve('src/testing/fixtures/handler-with-dep.ts'),
        runtime: aws_lambda.Runtime.NODEJS_24_X,
        architecture: aws_lambda.Architecture.ARM_64,
        depsLockFilePath: path.resolve('pnpm-lock.yaml'),
        projectRoot: path.resolve('.'),
        nodeModules: ['zod'],
      });

      expect(
        bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
      ).toBe(true);

      const indexPath = path.join(outputDir, 'index.js');
      expect(fs.existsSync(indexPath), `index.js missing in ${outputDir}`).toBe(true);

      const bundleContent = fs.readFileSync(indexPath, 'utf-8');

      // zod should appear as an external require, not be inlined.
      expect(bundleContent, 'expected zod to be an external require').toMatch(
        /require\(["']zod["']\)/,
      );

      // CDK should have installed zod into node_modules in the output dir.
      expect(
        fs.existsSync(path.join(outputDir, 'node_modules', 'zod')),
        `zod not found in ${outputDir}/node_modules`,
      ).toBe(true);

      // The handler should resolve the external module from the output node_modules
      // and execute successfully.
      const require = createRequire(import.meta.url);
      const mod = require(indexPath) as { handler?: unknown };
      expect(typeof mod.handler, 'handler should be a function').toBe('function');

      const result = (await (mod.handler as (e: unknown) => Promise<unknown>)({
        bundler,
      })) as { zodExports: string[] };

      // z is a named export of zod — confirms the external module resolved correctly.
      expect(result.zodExports).toContain('z');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  },
  // pnpm install adds time on top of the bundler run; give each test room.
  120_000,
);

import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
 *   1. Bundle `handler-with-dep.ts` (which imports `unplugin`) with
 *      `nodeModules: ['unplugin']`.
 *   2. Assert that `unplugin` is referenced externally in the bundle (i.e. a
 *      `require("unplugin")` call, not inlined code).
 *   3. Assert that `unplugin` was installed into `node_modules` in the output
 *      directory by the CDK bundling step.
 *   4. Load the bundle and invoke the handler to confirm the external module
 *      resolves correctly at runtime.
 */
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
        nodeModules: ['unplugin'],
      });

      expect(
        bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
      ).toBe(true);

      const indexPath = path.join(outputDir, 'index.js');
      expect(fs.existsSync(indexPath), `index.js missing in ${outputDir}`).toBe(true);

      const bundleContent = fs.readFileSync(indexPath, 'utf-8');

      // unplugin should appear as an external require, not be inlined.
      expect(bundleContent, 'expected unplugin to be an external require').toMatch(
        /require\(["']unplugin["']\)/,
      );

      // CDK should have installed unplugin into node_modules in the output dir.
      expect(
        fs.existsSync(path.join(outputDir, 'node_modules', 'unplugin')),
        `unplugin not found in ${outputDir}/node_modules`,
      ).toBe(true);

      // The handler should resolve the external module from the output node_modules
      // and execute successfully.
      const require = createRequire(import.meta.url);
      const mod = require(indexPath) as { handler?: unknown };
      expect(typeof mod.handler, 'handler should be a function').toBe('function');

      const result = (await (mod.handler as (e: unknown) => Promise<unknown>)({
        bundler,
      })) as { bundlerKeys: string[] };

      // createUnplugin returns adapters for each supported bundler framework.
      expect(result.bundlerKeys).toContain('rollup');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  },
  // pnpm install adds time on top of the bundler run; give each test room.
  120_000,
);

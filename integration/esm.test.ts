import { pathToFileURL } from 'url';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as aws_lambda from 'aws-cdk-lib/aws-lambda';
import { expect, it } from 'vitest';
import { Bundling } from '../src/bundling.ts';
import { SUPPORTED_BUNDLERS } from '../src/types.ts';

/**
 * Integration tests that verify ESM output bundles receive `"type":"module"`
 * in the output package.json so Node.js loads index.js as ES module code.
 *
 * For each bundler we:
 *   1. Run the bundler against the ESM fixture config.
 *   2. Assert the output directory contains index.js.
 *   3. Assert package.json exists with `"type":"module"`.
 *   4. Load index.js via dynamic import and invoke handler to confirm it executes.
 */
it.each(SUPPORTED_BUNDLERS)(
  'writes type:module to package.json and produces a callable ESM handler for bundler: %s',
  async (bundler) => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `lambda-esm-${bundler}-`));
    try {
      const bundling = new Bundling({
        bundler,
        bundlerConfig: path.resolve(`src/testing/fixtures/${bundler}-esm.config.mjs`),
        entry: path.resolve('src/testing/fixtures/handler.ts'),
        runtime: aws_lambda.Runtime.NODEJS_24_X,
        architecture: aws_lambda.Architecture.ARM_64,
        depsLockFilePath: path.resolve('pnpm-lock.yaml'),
        projectRoot: path.resolve('.'),
      });

      expect(
        bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
      ).toBe(true);

      const indexPath = path.join(outputDir, 'index.js');
      expect(fs.existsSync(indexPath), `index.js missing in ${outputDir}`).toBe(true);

      const pkgJsonPath = path.join(outputDir, 'package.json');
      expect(fs.existsSync(pkgJsonPath), `package.json missing in ${outputDir}`).toBe(true);
      const outPkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as { type?: string };
      expect(outPkg.type, 'package.json must have type:module').toBe('module');

      const mod = (await import(pathToFileURL(indexPath).href)) as { handler?: unknown };
      expect(typeof mod.handler, 'handler should be a function').toBe('function');

      const event = { source: 'integration-test', bundler };
      const result = await (mod.handler as (e: unknown) => Promise<unknown>)(event);
      expect(result).toEqual(event);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  },
  60_000,
);

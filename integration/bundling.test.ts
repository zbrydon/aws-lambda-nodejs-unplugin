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
 * Integration tests that invoke each supported bundler end-to-end via the
 * same CDK bundling path that NodejsFunction uses in a real synthesis.
 *
 * For each bundler we:
 *   1. Run the bundler against the fixture handler.
 *   2. Assert the output directory contains index.js.
 *   3. Load index.js and assert handler is an exported function.
 *   4. Invoke handler and assert it returns the event (passthrough fixture).
 */
it.each(SUPPORTED_BUNDLERS)(
  'bundles handler and exports a callable function for bundler: %s',
  async (bundler) => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `lambda-bundle-${bundler}-`));
    try {
      const bundling = new Bundling({
        bundler,
        bundlerConfig: path.resolve(`integration/fixtures/${bundler}.config.mjs`),
        entry: path.resolve('integration/fixtures/handler.ts'),
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

      // Load the CJS bundle and verify the handler export.
      const require = createRequire(import.meta.url);
      const mod = require(indexPath) as { handler?: unknown };
      expect(typeof mod.handler, 'handler should be a function').toBe('function');

      // The fixture handler is a passthrough — result should equal the input event.
      const event = { source: 'integration-test', bundler };
      const result = await (mod.handler as (e: unknown) => Promise<unknown>)(event);
      expect(result).toEqual(event);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  },
  // Bundlers can take several seconds each; give each test enough headroom.
  60_000,
);

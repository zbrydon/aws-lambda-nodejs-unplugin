import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { expect, it } from 'vitest';
import { Bundling } from '../src/bundling.ts';
import { SUPPORTED_BUNDLERS } from '../src/types.ts';
import { BASE_BUNDLING_PROPS } from './test-utils.ts';

it.each(SUPPORTED_BUNDLERS)(
  'bundles handler and exports a callable function for bundler: %s',
  async (bundler) => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `lambda-bundle-${bundler}-`));
    try {
      const bundling = new Bundling({
        ...BASE_BUNDLING_PROPS,
        bundler,
        bundlerConfig: path.resolve(`integration/fixtures/${bundler}/config.mjs`),
        entry: path.resolve('integration/fixtures/handler.ts'),
      });

      expect(
        bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
      ).toBe(true);

      const indexPath = path.join(outputDir, 'index.js');
      expect(fs.existsSync(indexPath), `index.js missing in ${outputDir}`).toBe(true);

      const require = createRequire(import.meta.url);
      const mod = require(indexPath) as { handler?: unknown };
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

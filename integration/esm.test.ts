import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { expect, it } from 'vitest';
import { Bundling } from '../src/bundling.ts';
import { SUPPORTED_BUNDLERS } from '../src/types.ts';
import { BASE_BUNDLING_PROPS } from './test-utils.ts';

/**
 * Integration tests that verify ESM output bundles are emitted as `index.mjs`
 * and receive `"type":"module"` in the output package.json (so any secondary
 * code-split `.js` chunks are also treated as ES modules).
 *
 * For each bundler we:
 *   1. Run the bundler against the ESM fixture config.
 *   2. Assert the output directory contains index.mjs.
 *   3. Assert package.json exists with `"type":"module"`.
 *   4. Load index.mjs via dynamic import and invoke handler to confirm it executes.
 */
/**
 * T1: verify that ESM output combined with nodeModules produces a package.json
 * that has both `"type":"module"` and the installed dependency, and that the
 * handler resolves the external module from the output node_modules at runtime.
 */
it('ESM bundle with nodeModules gets type:module and installed dependency (esbuild)', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-esm-nodemodules-'));
  try {
    const bundling = new Bundling({
      ...BASE_BUNDLING_PROPS,
      bundler: 'esbuild',
      bundlerConfig: path.resolve('integration/fixtures/esbuild/esm.config.mjs'),
      entry: path.resolve('integration/fixtures/handler-with-dep.ts'),
      nodeModules: ['constructs'],
    });

    expect(
      bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
    ).toBe(true);

    const indexPath = path.join(outputDir, 'index.mjs');
    expect(fs.existsSync(indexPath), `index.mjs missing in ${outputDir}`).toBe(true);

    const pkgJsonPath = path.join(outputDir, 'package.json');
    expect(fs.existsSync(pkgJsonPath), `package.json missing`).toBe(true);
    const outPkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as {
      type?: string;
      dependencies?: Record<string, string>;
    };
    expect(outPkg.type, 'package.json must have type:module').toBe('module');
    expect(outPkg.dependencies, 'package.json must list constructs').toHaveProperty('constructs');

    expect(
      fs.existsSync(path.join(outputDir, 'node_modules', 'constructs')),
      'constructs not installed in node_modules',
    ).toBe(true);

    const mod = (await import(pathToFileURL(indexPath).href)) as { handler?: unknown };
    expect(typeof mod.handler, 'handler should be a function').toBe('function');
    const result = (await (mod.handler as (e: unknown) => Promise<unknown>)({})) as {
      constructsExports: string[];
    };
    expect(result.constructsExports).toContain('Construct');
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}, 120_000);

it.each(SUPPORTED_BUNDLERS)(
  'writes type:module to package.json and produces a callable ESM handler for bundler: %s',
  async (bundler) => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `lambda-esm-${bundler}-`));
    try {
      const bundling = new Bundling({
        ...BASE_BUNDLING_PROPS,
        bundler,
        bundlerConfig: path.resolve(`integration/fixtures/${bundler}/esm.config.mjs`),
        entry: path.resolve('integration/fixtures/handler.ts'),
      });

      expect(
        bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
      ).toBe(true);

      const indexPath = path.join(outputDir, 'index.mjs');
      expect(fs.existsSync(indexPath), `index.mjs missing in ${outputDir}`).toBe(true);

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

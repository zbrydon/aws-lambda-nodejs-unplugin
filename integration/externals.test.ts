import { createRequire } from 'node:module';
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
 * Integration tests that verify `nodeModules` are correctly installed
 * separately in the Lambda output directory, with externalization configured
 * directly in the bundler config rather than via the plugin.
 *
 * For each bundler we:
 *   1. Bundle `handler-with-dep.ts` (which imports `constructs`) using a
 *      `*-externals.config.mjs` fixture that marks constructs external natively.
 *   2. Pass `nodeModules: ['constructs']` to drive the install step only.
 *   3. Assert that `constructs` is referenced externally in the bundle (i.e. a
 *      `require("constructs")` call, not inlined code).
 *   4. Assert that `constructs` was installed into `node_modules` in the output
 *      directory by the CDK bundling step.
 *   5. Load the bundle and invoke the handler to confirm the external module
 *      resolves correctly at runtime.
 */
async function assertExternalConstructs(
  outputDir: string,
  bundler: string,
  mod: { handler?: unknown },
): Promise<void> {
  expect(
    fs.existsSync(path.join(outputDir, 'node_modules', 'constructs')),
    `constructs not installed for ${bundler}`,
  ).toBe(true);
  expect(typeof mod.handler, 'handler should be a function').toBe('function');
  const result = (await (mod.handler as (e: unknown) => Promise<unknown>)({ bundler })) as {
    constructsExports: string[];
  };
  expect(result.constructsExports).toContain('Construct');
}

/**
 * T6: multiple packages in nodeModules — verifies that the multi-package
 * install path works end-to-end. Uses esbuild with two separate packages.
 * (constructs provides both 'constructs' and 'constructs' — use rollup as the second package since
 * it is already installed in the project devDependencies.)
 */
it('installs multiple nodeModules packages for esbuild', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-multi-externals-'));
  try {
    const bundling = new Bundling({
      ...BASE_BUNDLING_PROPS,
      bundler: 'esbuild',
      bundlerConfig: path.resolve('integration/fixtures/esbuild/externals.config.mjs'),
      entry: path.resolve('integration/fixtures/handler-with-dep.ts'),
      nodeModules: ['constructs', 'rollup'],
    });

    expect(
      bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
    ).toBe(true);

    const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(outPkg.dependencies).toHaveProperty('constructs');
    expect(outPkg.dependencies).toHaveProperty('rollup');
    expect(
      fs.existsSync(path.join(outputDir, 'node_modules', 'constructs')),
      'constructs not installed',
    ).toBe(true);
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
        ...BASE_BUNDLING_PROPS,
        bundler,
        bundlerConfig: path.resolve(`integration/fixtures/${bundler}/esm-externals.config.mjs`),
        entry: path.resolve('integration/fixtures/handler-with-dep.ts'),
        nodeModules: ['constructs'],
      });

      expect(
        bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
      ).toBe(true);

      const indexPath = path.join(outputDir, 'index.mjs');
      expect(fs.existsSync(indexPath), `index.mjs missing in ${outputDir}`).toBe(true);

      const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8')) as {
        type?: string;
        dependencies?: Record<string, string>;
      };
      expect(outPkg.type, 'package.json must have type:module').toBe('module');
      expect(outPkg.dependencies, 'package.json must list constructs').toHaveProperty('constructs');

      const mod = (await import(pathToFileURL(indexPath).href)) as { handler?: unknown };
      await assertExternalConstructs(outputDir, bundler, mod);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  },
  120_000,
);

/**
 * ESM externals for a non-webpack/rspack bundler. Rollup emits ESM (index.mjs)
 * with constructs marked external; the install path must write `type: module` and the
 * handler must resolve the external module at runtime.
 */
it('excludes nodeModules from a rollup ESM bundle and installs them', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-esm-ext-rollup-'));
  try {
    const bundling = new Bundling({
      ...BASE_BUNDLING_PROPS,
      bundler: 'rollup',
      bundlerConfig: path.resolve('integration/fixtures/rollup/esm-externals.config.mjs'),
      entry: path.resolve('integration/fixtures/handler-with-dep.ts'),
      nodeModules: ['constructs'],
    });

    expect(
      bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
    ).toBe(true);

    const indexPath = path.join(outputDir, 'index.mjs');
    expect(fs.existsSync(indexPath), `index.mjs missing in ${outputDir}`).toBe(true);

    const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8')) as {
      type?: string;
      dependencies?: Record<string, string>;
    };
    expect(outPkg.type, 'package.json must have type:module').toBe('module');
    expect(outPkg.dependencies, 'package.json must list constructs').toHaveProperty('constructs');

    const mod = (await import(pathToFileURL(indexPath).href)) as { handler?: unknown };
    await assertExternalConstructs(outputDir, 'rollup', mod);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}, 120_000);

/**
 * ESM externals for the remaining bundlers (esbuild / vite / rolldown / farm).
 * Each emits ESM (index.mjs) with `constructs` marked external natively, so the
 * install path must write `type: module` and the handler must resolve the
 * external module at runtime. Backs the "every bridge, ESM + externals" claim
 * alongside the rollup/webpack/rspack cases above.
 */
it.each(['esbuild', 'vite', 'rolldown', 'farm'] as const)(
  'excludes nodeModules from an ESM bundle and installs them for bundler: %s',
  async (bundler) => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `lambda-esm-ext-${bundler}-`));
    try {
      const bundling = new Bundling({
        ...BASE_BUNDLING_PROPS,
        bundler,
        bundlerConfig: path.resolve(`integration/fixtures/${bundler}/esm-externals.config.mjs`),
        entry: path.resolve('integration/fixtures/handler-with-dep.ts'),
        nodeModules: ['constructs'],
      });

      expect(
        bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
      ).toBe(true);

      const indexPath = path.join(outputDir, 'index.mjs');
      expect(fs.existsSync(indexPath), `index.mjs missing in ${outputDir}`).toBe(true);

      const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8')) as {
        type?: string;
        dependencies?: Record<string, string>;
      };
      expect(outPkg.type, 'package.json must have type:module').toBe('module');
      expect(outPkg.dependencies, 'package.json must list constructs').toHaveProperty('constructs');

      const mod = (await import(pathToFileURL(indexPath).href)) as { handler?: unknown };
      await assertExternalConstructs(outputDir, bundler, mod);
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
      ...BASE_BUNDLING_PROPS,
      bundler: 'farm',
      bundlerConfig: configPath,
      entry: path.resolve('integration/fixtures/handler.ts'),
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
        ...BASE_BUNDLING_PROPS,
        bundler,
        bundlerConfig: path.resolve(`integration/fixtures/${bundler}/externals.config.mjs`),
        entry: path.resolve('integration/fixtures/handler-with-dep.ts'),
        nodeModules: ['constructs'],
      });

      expect(
        bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
      ).toBe(true);

      const indexPath = path.join(outputDir, 'index.js');
      expect(fs.existsSync(indexPath), `index.js missing in ${outputDir}`).toBe(true);

      const bundleContent = fs.readFileSync(indexPath, 'utf-8');
      // constructs should appear as an external require, not be inlined.
      expect(bundleContent, 'expected constructs to be an external require').toMatch(
        /require\(["']constructs["']\)/,
      );

      const require = createRequire(import.meta.url);
      const mod = require(indexPath) as { handler?: unknown };
      await assertExternalConstructs(outputDir, bundler, mod);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  },
  // pnpm install adds time on top of the bundler run; give each test room.
  120_000,
);

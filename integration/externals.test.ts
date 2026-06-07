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

it('Farm bridge enforces index.js output filename regardless of user entryFilename', async () => {
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

it('Farm bridge defaults to ESM (index.mjs + type:module) when output.format is omitted', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-default-format-'));
  try {
    const bundling = new Bundling({
      ...BASE_BUNDLING_PROPS,
      bundler: 'farm',
      bundlerConfig: path.resolve('integration/fixtures/farm/default-format.config.mjs'),
      entry: path.resolve('integration/fixtures/handler.ts'),
    });

    expect(
      bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
    ).toBe(true);

    const indexPath = path.join(outputDir, 'index.mjs');
    expect(fs.existsSync(indexPath), `index.mjs missing in ${outputDir}`).toBe(true);
    expect(
      fs.existsSync(path.join(outputDir, 'index.js')),
      'index.js should not exist when the ESM default is used',
    ).toBe(false);

    const pkgJsonPath = path.join(outputDir, 'package.json');
    expect(fs.existsSync(pkgJsonPath), 'package.json missing').toBe(true);
    const outPkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as { type?: string };
    expect(outPkg.type, 'package.json must have type:module').toBe('module');

    const mod = (await import(pathToFileURL(indexPath).href)) as { handler?: unknown };
    expect(typeof mod.handler, 'handler should be a function').toBe('function');
    const event = { source: 'integration-test', bundler: 'farm' };
    const result = await (mod.handler as (e: unknown) => Promise<unknown>)(event);
    expect(result).toEqual(event);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
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

  120_000,
);

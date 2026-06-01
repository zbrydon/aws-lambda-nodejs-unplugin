import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as aws_lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';
import { expect, it } from 'vitest';
import { Bundling } from '../src/bundling.ts';

/**
 * End-to-end coverage for a non-pnpm package manager. The rest of the
 * integration suite hardcodes pnpm via BASE_BUNDLING_PROPS, so this exercises
 * the npm fallback install path (`npm install`, no lock file) through the same
 * CDK bundling pipeline.
 *
 * To stay offline and deterministic the installed package is a local `file:`
 * dependency rather than a registry package.
 */
it('installs nodeModules with npm when no lock file or packageManager is present', () => {
  // A self-contained project root: package.json declares a local file: dep, no
  // lock file and no packageManager field, so detection falls back to npm.
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-project-'));
  const localDep = path.join(projectRoot, 'local-dep');
  fs.mkdirSync(localDep);
  fs.writeFileSync(
    path.join(localDep, 'package.json'),
    JSON.stringify({ name: 'local-dep', version: '1.0.0', main: 'index.js' }),
  );
  fs.writeFileSync(path.join(localDep, 'index.js'), 'module.exports = { ok: true };');

  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({
      name: 'npm-project',
      dependencies: { 'local-dep': `file:${localDep}` },
    }),
  );

  const entry = path.join(projectRoot, 'handler.ts');
  fs.writeFileSync(entry, 'export const handler = async (event: unknown) => event;');

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-out-'));
  try {
    const bundling = new Bundling({
      runtime: aws_lambda.Runtime.NODEJS_24_X,
      architecture: aws_lambda.Architecture.ARM_64,
      // No lock file on disk; the copy step is skipped and npm detection falls back.
      depsLockFilePath: path.join(projectRoot, 'package-lock.json'),
      projectRoot,
      bundler: 'esbuild',
      bundlerConfig: path.resolve('integration/fixtures/esbuild.config.mjs'),
      entry,
      nodeModules: ['local-dep'],
    });

    expect(
      bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }),
    ).toBe(true);

    const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(outPkg.dependencies).toHaveProperty('local-dep');
    expect(
      fs.existsSync(path.join(outputDir, 'node_modules', 'local-dep')),
      'local-dep should be installed by npm into the output node_modules',
    ).toBe(true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}, 120_000);

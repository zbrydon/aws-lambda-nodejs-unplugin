import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as aws_lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';
import { expect, it } from 'vitest';
import { Bundling } from '../src/bundling.ts';

const hasBin = (bin: string): boolean => {
  const probe = spawnSync(bin, ['--version'], { encoding: 'utf8', cwd: os.tmpdir() });
  return !probe.error && probe.status === 0;
};

it('installs nodeModules with npm when no lock file or packageManager is present', () => {
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
      depsLockFilePath: path.join(projectRoot, 'package-lock.json'),
      projectRoot,
      bundler: 'esbuild',
      bundlerConfig: path.resolve('integration/fixtures/esbuild/config.mjs'),
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

const installsWithPackageManager = (
  pm: 'yarn' | 'bun',
  lockFile: string,
  workspaceFiles: Record<string, string>,
): boolean => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${pm}-project-`));
  const localDep = path.join(projectRoot, 'local-dep');
  fs.mkdirSync(localDep);
  fs.writeFileSync(
    path.join(localDep, 'package.json'),
    JSON.stringify({ name: 'local-dep', version: '1.0.0', main: 'index.js' }),
  );
  fs.writeFileSync(path.join(localDep, 'index.js'), 'module.exports = { ok: true };');
  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ name: `${pm}-project`, dependencies: { 'local-dep': `file:${localDep}` } }),
  );

  fs.writeFileSync(path.join(projectRoot, lockFile), '');
  for (const [file, content] of Object.entries(workspaceFiles)) {
    fs.writeFileSync(path.join(projectRoot, file), content);
  }

  const entry = path.join(projectRoot, 'handler.ts');
  fs.writeFileSync(entry, 'export const handler = async (event: unknown) => event;');

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `${pm}-out-`));
  try {
    const bundling = new Bundling({
      runtime: aws_lambda.Runtime.NODEJS_24_X,
      architecture: aws_lambda.Architecture.ARM_64,
      depsLockFilePath: path.join(projectRoot, lockFile),
      projectRoot,
      bundler: 'esbuild',
      bundlerConfig: path.resolve('integration/fixtures/esbuild/config.mjs'),
      entry,
      nodeModules: ['local-dep'],
    });

    const bundled = bundling.local.tryBundle(outputDir, {
      image: cdk.DockerImage.fromRegistry('dummy'),
    });
    return bundled && fs.existsSync(path.join(outputDir, 'node_modules', 'local-dep'));
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
};

it.skipIf(!hasBin('yarn'))(
  'installs nodeModules with yarn',
  () => {
    expect(
      installsWithPackageManager('yarn', 'yarn.lock', {
        '.yarnrc.yml': 'nodeLinker: node-modules\nenableImmutableInstalls: false\n',
      }),
    ).toBe(true);
  },
  180_000,
);

it.skipIf(!hasBin('bun'))(
  'installs nodeModules with bun',
  () => {
    expect(installsWithPackageManager('bun', 'bun.lock', {})).toBe(true);
  },
  180_000,
);

const runPostinstallSentinel = (
  ignoreScripts: boolean,
): { installed: boolean; sentinelRan: boolean } => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ignorescripts-project-'));
  const localDep = path.join(projectRoot, 'local-dep');
  fs.mkdirSync(localDep);
  fs.writeFileSync(
    path.join(localDep, 'package.json'),
    JSON.stringify({
      name: 'local-dep',
      version: '1.0.0',
      main: 'index.js',
      scripts: { postinstall: `node -e "require('fs').writeFileSync('postinstall-ran','1')"` },
    }),
  );
  fs.writeFileSync(path.join(localDep, 'index.js'), 'module.exports = { ok: true };');
  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({
      name: 'ignorescripts-project',
      dependencies: { 'local-dep': `file:${localDep}` },
    }),
  );

  const entry = path.join(projectRoot, 'handler.ts');
  fs.writeFileSync(entry, 'export const handler = async (event: unknown) => event;');

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ignorescripts-out-'));
  try {
    const bundling = new Bundling({
      runtime: aws_lambda.Runtime.NODEJS_24_X,
      architecture: aws_lambda.Architecture.ARM_64,
      depsLockFilePath: path.join(projectRoot, 'package-lock.json'),
      projectRoot,
      bundler: 'esbuild',
      bundlerConfig: path.resolve('integration/fixtures/esbuild/config.mjs'),
      entry,
      nodeModules: ['local-dep'],
      ignoreScripts,
    });

    const installed =
      bundling.local.tryBundle(outputDir, { image: cdk.DockerImage.fromRegistry('dummy') }) &&
      fs.existsSync(path.join(outputDir, 'node_modules', 'local-dep'));
    const sentinelRan = fs.existsSync(
      path.join(outputDir, 'node_modules', 'local-dep', 'postinstall-ran'),
    );
    return { installed, sentinelRan };
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
};

it('does not run dependency lifecycle scripts when ignoreScripts is true', () => {
  const { installed, sentinelRan } = runPostinstallSentinel(true);
  expect(installed, 'local-dep should still be installed').toBe(true);
  expect(sentinelRan, 'postinstall sentinel must not run with ignoreScripts: true').toBe(false);
}, 120_000);

it('runs dependency lifecycle scripts by default (ignoreScripts false)', () => {
  const { installed, sentinelRan } = runPostinstallSentinel(false);
  expect(installed, 'local-dep should be installed').toBe(true);
  expect(sentinelRan, 'postinstall sentinel should run by default').toBe(true);
}, 120_000);

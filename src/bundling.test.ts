import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from './errors.ts';
import type { BundlingProps } from './bundling.ts';
import { Bundling } from './bundling.ts';

vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  return { ...original, spawnSync: vi.fn<typeof original.spawnSync>() };
});

const spawnSyncMock = vi.mocked(spawnSync);

const makeSuccessResult = () => ({
  status: 0,
  error: undefined,
  pid: 1,
  output: [],
  stdout: Buffer.from(''),
  stderr: Buffer.from(''),
  signal: null,
});

const makeErrorResult = (status: number) => ({
  status,
  error: undefined,
  pid: 1,
  output: [],
  stdout: Buffer.from(''),
  stderr: Buffer.from(''),
  signal: null,
});

const makeSpawnError = (err: Error) => ({
  status: null,
  error: err,
  pid: 1,
  output: [],
  stdout: Buffer.from(''),
  stderr: Buffer.from(''),
  signal: null,
});

let tmpDir: string;
let entryFile: string;
let pkgJsonPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundling-test-'));
  entryFile = path.join(tmpDir, 'handler.ts');
  pkgJsonPath = path.join(tmpDir, 'package.json');
  fs.writeFileSync(entryFile, 'export const handler = () => {};');
  fs.writeFileSync(pkgJsonPath, JSON.stringify({ dependencies: { pino: '^9' } }));
  fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');

  // Default: all spawnSync calls succeed (corepack check + bundler)
  spawnSyncMock.mockReturnValue(makeSuccessResult());
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  // resetAllMocks clears mockReturnValueOnce queues so values don't bleed between tests.
  vi.resetAllMocks();
});

const makeProps = (overrides: Partial<BundlingProps> = {}): BundlingProps => ({
  bundler: 'esbuild',
  bundlerConfig: path.join(tmpDir, 'build.mjs'),
  entry: entryFile,
  runtime: lambda.Runtime.NODEJS_24_X,
  architecture: lambda.Architecture.X86_64,
  depsLockFilePath: path.join(tmpDir, 'pnpm-lock.yaml'),
  projectRoot: tmpDir,
  ...overrides,
});

describe('Bundling.bundle', () => {
  it('returns an AssetCode', () => {
    const code = Bundling.bundle(makeProps());
    expect(code).toBeDefined();
  });
});

describe('Bundling.local.tryBundle', () => {
  it('spawns a node bridge script with the bundler config embedded', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(makeProps());
      bundling.local.tryBundle(outputDir, bundling);

      const bridgeCall = spawnSyncMock.mock.calls.find((c) => c[0] === 'node');
      expect(bridgeCall).toBeDefined();

      const args = bridgeCall![1] as string[];
      // args: [bridgeScriptPath, configPath, entry, outputDir]
      expect(args[0]).toMatch(/esbuild\.mjs$/);
      expect(args[1]).toBe(path.join(tmpDir, 'build.mjs')); // configPath
      expect(args[2]).toBe(entryFile); // entry
      expect(args[3]).toBe(outputDir); // outputDir
      expect((bridgeCall![2] as { cwd?: string }).cwd).toBe(tmpDir);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('throws ValidationError when bundler exits non-zero', () => {
    // No corepack check: test package.json has no packageManager field.
    spawnSyncMock.mockReturnValueOnce(makeErrorResult(1)); // bundler

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(makeProps());
      expect(() => bundling.local.tryBundle(outputDir, bundling)).toThrow(ValidationError);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('rethrows spawn errors from the bundler', () => {
    // No corepack check: test package.json has no packageManager field.
    spawnSyncMock.mockReturnValueOnce(makeSpawnError(new Error('ENOENT'))); // bundler

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(makeProps());
      expect(() => bundling.local.tryBundle(outputDir, bundling)).toThrow('ENOENT');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('runs beforeBundling hooks before the bundler', () => {
    const order: string[] = [];
    spawnSyncMock.mockImplementation((cmd) => {
      order.push(String(cmd));
      return makeSuccessResult();
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(
        makeProps({
          commandHooks: {
            beforeBundling: () => ['echo before'],
            afterBundling: () => [],
            beforeInstall: () => [],
          },
        }),
      );
      bundling.local.tryBundle(outputDir, bundling);

      const bashIdx = order.indexOf('bash');
      const nodeIdx = order.indexOf('node');
      expect(bashIdx).toBeGreaterThanOrEqual(0);
      expect(nodeIdx).toBeGreaterThan(bashIdx);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('runs afterBundling hooks after the bundler', () => {
    const order: string[] = [];
    spawnSyncMock.mockImplementation((cmd) => {
      order.push(String(cmd));
      return makeSuccessResult();
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(
        makeProps({
          commandHooks: {
            beforeBundling: () => [],
            afterBundling: () => ['echo after'],
            beforeInstall: () => [],
          },
        }),
      );
      bundling.local.tryBundle(outputDir, bundling);

      const nodeIdx = order.indexOf('node');
      const lastBashIdx = order.lastIndexOf('bash');
      expect(lastBashIdx).toBeGreaterThan(nodeIdx);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('installs nodeModules and writes package.json', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(
        makeProps({
          nodeModules: ['pino'],
        }),
      );
      bundling.local.tryBundle(outputDir, bundling);

      const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8'));
      expect(outPkg.dependencies).toHaveProperty('pino');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('writes packageManager field when detected from packageManager key', () => {
    fs.writeFileSync(
      pkgJsonPath,
      JSON.stringify({
        packageManager: 'pnpm@9.0.0',
        dependencies: { pino: '^9' },
      }),
    );

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      // corepack NOT available so no corepack prefix. Keyed on the command so it
      // is independent of the order in which the bundler/corepack/install spawn.
      spawnSyncMock.mockImplementation((cmd) =>
        cmd === 'corepack' ? makeErrorResult(1) : makeSuccessResult(),
      );

      const bundling = new Bundling(makeProps({ nodeModules: ['pino'], projectRoot: tmpDir }));
      bundling.local.tryBundle(outputDir, bundling);

      const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8'));
      expect(outPkg.packageManager).toBe('pnpm@9.0.0');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('throws ValidationError when package manager install fails', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      // No corepack check: test package.json has no packageManager field.
      spawnSyncMock
        .mockReturnValueOnce(makeSuccessResult()) // bundler
        .mockReturnValueOnce(makeErrorResult(1)); // pm install

      const bundling = new Bundling(makeProps({ nodeModules: ['pino'] }));
      expect(() => bundling.local.tryBundle(outputDir, bundling)).toThrow(ValidationError);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('copies lock file when it exists', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(makeProps({ nodeModules: ['pino'] }));
      bundling.local.tryBundle(outputDir, bundling);

      expect(fs.existsSync(path.join(outputDir, 'pnpm-lock.yaml'))).toBe(true);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('throws when nodeModules set but no package.json found', () => {
    // Remove the package.json from the temp dir
    fs.unlinkSync(pkgJsonPath);

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(
        makeProps({
          nodeModules: ['pino'],
          entry: path.join(os.tmpdir(), 'nonexistent_dir', 'handler.ts'),
        }),
      );
      expect(() => bundling.local.tryBundle(outputDir, bundling)).toThrow(
        'Cannot find a package.json',
      );
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('runs beforeInstall hook before installing nodeModules', () => {
    const order: string[] = [];
    spawnSyncMock.mockImplementation((cmd, args) => {
      if (cmd === 'bash') {
        order.push(`bash:${(args as string[]).join(' ')}`);
      } else {
        order.push(String(cmd));
      }
      return makeSuccessResult();
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(
        makeProps({
          nodeModules: ['pino'],
          commandHooks: {
            beforeBundling: () => [],
            afterBundling: () => [],
            beforeInstall: () => ['echo install'],
          },
        }),
      );
      bundling.local.tryBundle(outputDir, bundling);

      const beforeInstallIdx = order.findIndex((s) => s.includes('echo install'));
      const pmIdx = order.indexOf('pnpm');
      expect(beforeInstallIdx).toBeGreaterThanOrEqual(0);
      expect(pmIdx).toBeGreaterThan(beforeInstallIdx);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('passes custom assetHash to Code.fromAsset', () => {
    const code = Bundling.bundle(makeProps({ assetHash: 'abc123' }));
    expect(code).toBeDefined();
  });

  it('copies lock file from depsLockFilePath even when it is not in projectRoot', () => {
    // Regression: previously the lock file was re-derived from projectRoot,
    // so an explicit depsLockFilePath at a non-standard location was silently ignored.
    //
    // Setup: tmpDir is projectRoot (pnpm-lock.yaml present → pnpm detected).
    // customLockFile is the explicit depsLockFilePath; distinct content so
    // we can verify it is the file that ends up in the output dir.
    const customLockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-lock-'));
    const customLockFile = path.join(customLockDir, 'pnpm-lock.yaml');
    fs.writeFileSync(customLockFile, 'lockfileVersion: custom');

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(
        makeProps({
          nodeModules: ['pino'],
          projectRoot: tmpDir, // has its own pnpm-lock.yaml for PM detection
          depsLockFilePath: customLockFile, // explicit non-standard location
        }),
      );
      bundling.local.tryBundle(outputDir, bundling);

      // The output must use the explicitly supplied lock file, not the one in projectRoot.
      expect(fs.existsSync(path.join(outputDir, 'pnpm-lock.yaml'))).toBe(true);
      expect(fs.readFileSync(path.join(outputDir, 'pnpm-lock.yaml'), 'utf8')).toBe(
        'lockfileVersion: custom',
      );
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
      fs.rmSync(customLockDir, { recursive: true, force: true });
    }
  });

  it('copies bun.lockb under its original basename even when pm.lockFile resolves to bun.lock', () => {
    // Regression: pm.lockFile is derived from projectRoot, not from depsLockFilePath.
    // When bun.lock exists in projectRoot, pm.lockFile = 'bun.lock'.  If the caller
    // explicitly passes depsLockFilePath pointing to bun.lockb (binary format), the
    // old code would copy the binary content to outputDir/bun.lock (the wrong name).
    // The fix uses path.basename(depsLockFilePath) for the destination.

    // Re-configure projectRoot: replace pnpm-lock.yaml with bun.lock so bun is detected.
    fs.unlinkSync(path.join(tmpDir, 'pnpm-lock.yaml'));
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');

    const binaryLockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-lock-'));
    const binaryLockFile = path.join(binaryLockDir, 'bun.lockb');
    fs.writeFileSync(binaryLockFile, 'BINARY_LOCK_CONTENT');

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(
        makeProps({
          nodeModules: ['pino'],
          projectRoot: tmpDir,
          depsLockFilePath: binaryLockFile,
        }),
      );
      bundling.local.tryBundle(outputDir, bundling);

      // Must be written as bun.lockb, not bun.lock.
      expect(fs.existsSync(path.join(outputDir, 'bun.lockb'))).toBe(true);
      expect(fs.readFileSync(path.join(outputDir, 'bun.lockb'), 'utf8')).toBe(
        'BINARY_LOCK_CONTENT',
      );
      expect(fs.existsSync(path.join(outputDir, 'bun.lock'))).toBe(false);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
      fs.rmSync(binaryLockDir, { recursive: true, force: true });
    }
  });

  it('skips lock file copy when depsLockFilePath does not exist on disk', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(
        makeProps({
          nodeModules: ['pino'],
          depsLockFilePath: path.join(tmpDir, 'nonexistent-lock.yaml'),
        }),
      );
      bundling.local.tryBundle(outputDir, bundling);

      // Nothing to copy; output dir should have no lock file.
      expect(fs.existsSync(path.join(outputDir, 'pnpm-lock.yaml'))).toBe(false);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('rethrows pm install spawn error', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      spawnSyncMock
        .mockReturnValueOnce(makeSuccessResult()) // bundler
        .mockReturnValueOnce(makeSpawnError(new Error('INSTALL_ENOENT'))); // pm install

      const bundling = new Bundling(makeProps({ nodeModules: ['pino'] }));
      expect(() => bundling.local.tryBundle(outputDir, bundling)).toThrow('INSTALL_ENOENT');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('rethrows shell spawn error from commandHook', () => {
    spawnSyncMock.mockImplementation((cmd) => {
      if (cmd === 'bash') {
        return makeSpawnError(new Error('HOOK_ENOENT'));
      }
      return makeSuccessResult();
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(
        makeProps({
          commandHooks: {
            beforeBundling: () => ['echo hook'],
            afterBundling: () => [],
            beforeInstall: () => [],
          },
        }),
      );
      expect(() => bundling.local.tryBundle(outputDir, bundling)).toThrow('HOOK_ENOENT');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('throws ValidationError when command hook exits non-zero', () => {
    spawnSyncMock.mockImplementation((cmd) => {
      if (cmd === 'bash') {
        return makeErrorResult(1);
      }
      return makeSuccessResult();
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(
        makeProps({
          commandHooks: {
            beforeBundling: () => ['npm run prepare'],
            afterBundling: () => [],
            beforeInstall: () => [],
          },
        }),
      );
      expect(() => bundling.local.tryBundle(outputDir, bundling)).toThrow(ValidationError);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('includes signal name in error when command hook is killed by signal', () => {
    spawnSyncMock.mockImplementation((cmd) => {
      if (cmd === 'bash') {
        return {
          status: null,
          error: undefined,
          pid: 1,
          output: [],
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          signal: 'SIGTERM',
        } as ReturnType<typeof spawnSync>;
      }
      return makeSuccessResult();
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(
        makeProps({
          commandHooks: {
            beforeBundling: () => ['npm run prepare'],
            afterBundling: () => [],
            beforeInstall: () => [],
          },
        }),
      );
      expect(() => bundling.local.tryBundle(outputDir, bundling)).toThrow('SIGTERM');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('includes signal name in error when bundler is killed by signal', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: null,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      signal: 'SIGKILL',
    } as ReturnType<typeof spawnSync>);

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(makeProps());
      expect(() => bundling.local.tryBundle(outputDir, bundling)).toThrow('SIGKILL');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('includes signal name in error when package manager install is killed by signal', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      spawnSyncMock
        .mockReturnValueOnce(makeSuccessResult()) // bundler
        .mockReturnValueOnce({
          status: null,
          error: undefined,
          pid: 1,
          output: [],
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          signal: 'SIGTERM',
        } as ReturnType<typeof spawnSync>); // pm install

      const bundling = new Bundling(makeProps({ nodeModules: ['pino'] }));
      expect(() => bundling.local.tryBundle(outputDir, bundling)).toThrow('SIGTERM');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('writes type:module to package.json when bridge reports esm format with nodeModules', () => {
    spawnSyncMock.mockImplementation((cmd, args) => {
      if (cmd === 'node') {
        const outDir = (args as string[])[3]!;
        fs.writeFileSync(
          path.join(outDir, '.lambda-bundle-meta'),
          JSON.stringify({ format: 'esm' }),
        );
      }
      return makeSuccessResult();
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(makeProps({ nodeModules: ['pino'] }));
      bundling.local.tryBundle(outputDir, bundling);

      const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8'));
      expect(outPkg.type).toBe('module');
      expect(outPkg.dependencies).toHaveProperty('pino');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('writes package.json with type:module when bridge reports esm format without nodeModules', () => {
    spawnSyncMock.mockImplementation((cmd, args) => {
      if (cmd === 'node') {
        const outDir = (args as string[])[3]!;
        fs.writeFileSync(
          path.join(outDir, '.lambda-bundle-meta'),
          JSON.stringify({ format: 'esm' }),
        );
      }
      return makeSuccessResult();
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(makeProps());
      bundling.local.tryBundle(outputDir, bundling);

      const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8'));
      expect(outPkg).toEqual({ type: 'module' });
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('writes package.json with type:module when bridge reports es format (rollup convention)', () => {
    spawnSyncMock.mockImplementation((cmd, args) => {
      if (cmd === 'node') {
        const outDir = (args as string[])[3]!;
        fs.writeFileSync(
          path.join(outDir, '.lambda-bundle-meta'),
          JSON.stringify({ format: 'es' }),
        );
      }
      return makeSuccessResult();
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(makeProps());
      bundling.local.tryBundle(outputDir, bundling);

      const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8'));
      expect(outPkg.type).toBe('module');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('does not write type field when bridge reports cjs format', () => {
    spawnSyncMock.mockImplementation((cmd, args) => {
      if (cmd === 'node') {
        const outDir = (args as string[])[3]!;
        fs.writeFileSync(
          path.join(outDir, '.lambda-bundle-meta'),
          JSON.stringify({ format: 'cjs' }),
        );
      }
      return makeSuccessResult();
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(makeProps({ nodeModules: ['pino'] }));
      bundling.local.tryBundle(outputDir, bundling);

      const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8'));
      expect(outPkg.type).toBeUndefined();
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('does not write package.json when bridge reports no format and no nodeModules', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(makeProps());
      bundling.local.tryBundle(outputDir, bundling);

      expect(fs.existsSync(path.join(outputDir, 'package.json'))).toBe(false);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('removes .lambda-bundle-meta even when its contents are not valid JSON', () => {
    spawnSyncMock.mockImplementation((cmd, args) => {
      if (cmd === 'node') {
        const outDir = (args as string[])[3]!;
        fs.writeFileSync(path.join(outDir, '.lambda-bundle-meta'), 'not-json{');
      }
      return makeSuccessResult();
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(makeProps());
      expect(() => bundling.local.tryBundle(outputDir, bundling)).toThrow(SyntaxError);
      // The malformed meta must still be cleaned up so it never leaks into the asset.
      expect(fs.existsSync(path.join(outputDir, '.lambda-bundle-meta'))).toBe(false);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('cleans up .lambda-bundle-meta after reading it', () => {
    spawnSyncMock.mockImplementation((cmd, args) => {
      if (cmd === 'node') {
        const outDir = (args as string[])[3]!;
        fs.writeFileSync(
          path.join(outDir, '.lambda-bundle-meta'),
          JSON.stringify({ format: 'esm' }),
        );
      }
      return makeSuccessResult();
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(makeProps());
      bundling.local.tryBundle(outputDir, bundling);

      expect(fs.existsSync(path.join(outputDir, '.lambda-bundle-meta'))).toBe(false);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('resolves a relative bundlerConfig against projectRoot', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      // Pass a relative path; expect it to be resolved against projectRoot (tmpDir).
      const bundling = new Bundling(makeProps({ bundlerConfig: 'build.mjs' }));
      bundling.local.tryBundle(outputDir, bundling);

      const bridgeCall = spawnSyncMock.mock.calls.find((c) => c[0] === 'node');
      expect(bridgeCall).toBeDefined();

      // args[1] is configPath: must be the absolute resolved path.
      const args = bridgeCall![1] as string[];
      expect(args[1]).toBe(path.join(tmpDir, 'build.mjs'));
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('does not invoke beforeInstall hook when nodeModules is not set', () => {
    let beforeInstallCalled = false;
    const bundling = new Bundling(
      makeProps({
        commandHooks: {
          beforeBundling: () => [],
          afterBundling: () => [],
          beforeInstall: () => {
            beforeInstallCalled = true;
            return ['echo should-not-run'];
          },
        },
      }),
    );

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      bundling.local.tryBundle(outputDir, bundling);
      expect(beforeInstallCalled).toBe(false);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('installs multiple nodeModules and writes all dependencies to package.json', () => {
    fs.writeFileSync(pkgJsonPath, JSON.stringify({ dependencies: { pino: '^9', zod: '4.4.3' } }));

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    try {
      const bundling = new Bundling(makeProps({ nodeModules: ['pino', 'zod'] }));
      bundling.local.tryBundle(outputDir, bundling);

      const outPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8'));
      expect(outPkg.dependencies).toHaveProperty('pino');
      expect(outPkg.dependencies).toHaveProperty('zod');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

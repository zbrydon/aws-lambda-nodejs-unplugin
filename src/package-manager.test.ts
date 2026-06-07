import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORKSPACE_FILES,
  copyWorkspaceFiles,
  detectPackageManager,
  isCorepackAvailable,
  resetCorepackCache,
} from './package-manager.ts';

vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  return { ...original, spawnSync: vi.fn<typeof original.spawnSync>(original.spawnSync) };
});

const spawnSyncMock = vi.mocked(spawnSync);

describe('isCorepackAvailable', () => {
  beforeEach(() => {
    resetCorepackCache();
  });

  it('returns true when corepack exits 0', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      signal: null,
    });
    expect(isCorepackAvailable()).toBe(true);
  });

  it('returns false when corepack exits non-zero', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 1,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      signal: null,
    });
    expect(isCorepackAvailable()).toBe(false);
  });

  it('returns false when corepack errors', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: null,
      error: new Error('ENOENT'),
      pid: 1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      signal: null,
    });
    expect(isCorepackAvailable()).toBe(false);
  });

  it('does not memoize a transient probe timeout and re-probes on the next call', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: null,
      error: Object.assign(new Error('spawnSync corepack ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      pid: 1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      signal: 'SIGTERM',
    });

    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from('0.24.0'),
      stderr: Buffer.from(''),
      signal: null,
    });

    const callsBefore = spawnSyncMock.mock.calls.length;
    expect(isCorepackAvailable()).toBe(false);
    expect(isCorepackAvailable()).toBe(true);
    expect(spawnSyncMock.mock.calls).toHaveLength(callsBefore + 2);
  });

  it('memoizes the result and does not re-probe on the second call', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from('0.24.0'),
      stderr: Buffer.from(''),
      signal: null,
    });
    const callsBefore = spawnSyncMock.mock.calls.length;
    expect(isCorepackAvailable()).toBe(true);
    expect(isCorepackAvailable()).toBe(true);
    expect(spawnSyncMock.mock.calls).toHaveLength(callsBefore + 1);
  });
});

describe('detectPackageManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
    resetCorepackCache();
    spawnSyncMock.mockReturnValue({
      status: 1,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      signal: null,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('detects pnpm from packageManager field without corepack', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@9.0.0' }),
    );
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('pnpm');
    expect(info.version).toBe('9.0.0');
    expect(info.useCorepack).toBe(false);
    expect(info.packageManagerField).toBe('pnpm@9.0.0');
    expect(info.installCommand[0]).toBe('pnpm');
  });

  it('uses corepack prefix when packageManager field set and corepack available', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@9.0.0' }),
    );
    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from('0.24.0'),
      stderr: Buffer.from(''),
      signal: null,
    });
    const info = detectPackageManager(tmpDir);
    expect(info.useCorepack).toBe(true);
    expect(info.installCommand[0]).toBe('corepack');
    expect(info.installCommand[1]).toBe('pnpm');
  });

  it('detects yarn from packageManager field', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'yarn@4.0.0' }),
    );
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('yarn');
    expect(info.installCommand[0]).toBe('yarn');
  });

  it('detects npm from packageManager field', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'npm@10.0.0' }),
    );
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('npm');
    expect(info.installCommand[0]).toBe('npm');
  });

  it('detects bun from packageManager field', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'bun@1.0.0' }),
    );
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('bun');
    expect(info.installCommand[0]).toBe('bun');
  });

  it('detects pnpm from devEngines', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        devEngines: { packageManager: { name: 'pnpm', version: '9.0.0' } },
      }),
    );
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('pnpm');
    expect(info.version).toBe('9.0.0');
    expect(info.useCorepack).toBe(false);
    expect(info.packageManagerField).toBeUndefined();
  });

  it('detects from devEngines without version', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ devEngines: { packageManager: { name: 'yarn' } } }),
    );
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('yarn');
    expect(info.version).toBeUndefined();
  });

  it('detects pnpm from pnpm-lock.yaml', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('pnpm');
  });

  it('detects yarn from yarn.lock', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('yarn');
  });

  it('detects bun from bun.lock', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('bun');
  });

  it('detects bun from bun.lockb', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('bun');
  });

  it('detects npm from package-lock.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '');
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('npm');
  });

  it('uses npm ci when the resolved lock file is an existing package-lock.json', () => {
    const lock = path.join(tmpDir, 'package-lock.json');
    fs.writeFileSync(lock, '');
    const info = detectPackageManager(tmpDir, { lockFilePath: lock });
    expect(info.name).toBe('npm');
    expect(info.installCommand).toEqual(['npm', 'ci']);
  });

  it('uses npm install when the resolved package-lock.json does not exist on disk', () => {
    const lock = path.join(tmpDir, 'package-lock.json');
    const info = detectPackageManager(tmpDir, { lockFilePath: lock });
    expect(info.name).toBe('npm');
    expect(info.installCommand).toEqual(['npm', 'install']);
  });

  it('throws when a packageManager field conflicts with the resolved lock file', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'npm@10.0.0' }),
    );
    const otherLock = path.join(tmpDir, 'pnpm-lock.yaml');
    fs.writeFileSync(otherLock, '');
    expect(() => detectPackageManager(tmpDir, { lockFilePath: otherLock })).toThrow(
      /Package manager mismatch/,
    );
  });

  it('defaults to npm when nothing found', () => {
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('npm');
    expect(info.version).toBeUndefined();
  });

  it('ignores packageManager field with unknown pm name', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'unknown@1.0.0' }),
    );
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('npm');
  });

  it('pnpm install command uses --no-frozen-lockfile (not --no-prefer-frozen-lockfile)', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const info = detectPackageManager(tmpDir);
    expect(info.installCommand).toContain('--no-frozen-lockfile');
    expect(info.installCommand).not.toContain('--no-prefer-frozen-lockfile');
  });

  it('bun install command appends --ignore-scripts when ignoreScripts is set', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'bun@1.0.0' }),
    );
    const info = detectPackageManager(tmpDir, { ignoreScripts: true });
    expect(info.name).toBe('bun');
    expect(info.installCommand).toContain('--ignore-scripts');
  });

  it('bun install command omits --ignore-scripts by default', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'bun@1.0.0' }),
    );
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('bun');
    expect(info.installCommand).not.toContain('--ignore-scripts');
  });

  it('npm install command is "npm ci" when package-lock.json is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('npm');
    expect(info.installCommand).toContain('ci');
    expect(info.installCommand).not.toContain('install');
  });

  it('npm fallback uses "npm install" (not "npm ci") when no lock file is present', () => {
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('npm');
    expect(info.installCommand).toContain('install');
    expect(info.installCommand).not.toContain('ci');
  });

  it('devEngines with an unrecognised package manager name falls through to lock file detection', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ devEngines: { packageManager: { name: 'rush', version: '5.0.0' } } }),
    );

    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('pnpm');
  });

  it('falls through to npm default when package.json contains non-object JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify([]));
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('npm');
  });

  it('devEngines with an unrecognised package manager name falls through to npm default when no lock file', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ devEngines: { packageManager: { name: 'rush', version: '5.0.0' } } }),
    );
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('npm');

    expect(() =>
      info.workspaceFiles.forEach(() => {
        /* noop */
      }),
    ).not.toThrow();
  });

  it('reuses the provided lockFilePath to choose the package manager', () => {
    const info = detectPackageManager(tmpDir, {
      lockFilePath: path.join('/elsewhere', 'yarn.lock'),
    });
    expect(info.name).toBe('yarn');
  });

  it('honors a leaf package.json packageManager field over the project root in a monorepo', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'npm@10.0.0' }),
    );
    const leafDir = path.join(tmpDir, 'packages', 'leaf');
    fs.mkdirSync(leafDir, { recursive: true });
    fs.writeFileSync(
      path.join(leafDir, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@9.0.0' }),
    );

    const info = detectPackageManager(tmpDir, { startDir: leafDir });
    expect(info.name).toBe('pnpm');
    expect(info.version).toBe('9.0.0');
  });
});

describe('copyWorkspaceFiles', () => {
  let srcDir: string;
  let destDir: string;

  beforeEach(() => {
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-src-'));
    destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-dest-'));
    spawnSyncMock.mockReturnValue({
      status: 1,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      signal: null,
    });
  });

  afterEach(() => {
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(destDir, { recursive: true, force: true });
  });

  it('copies pnpm workspace files that exist', () => {
    fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), 'packages: []');
    fs.writeFileSync(path.join(srcDir, '.npmrc'), 'registry=...');

    detectPackageManager(srcDir);

    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
      nearestPackageJson: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo);

    expect(fs.existsSync(path.join(destDir, 'pnpm-workspace.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, '.npmrc'))).toBe(true);

    expect(fs.existsSync(path.join(destDir, '.pnpmfile.cjs'))).toBe(false);
  });

  const makeInfo = (name: 'npm' | 'pnpm' | 'yarn' | 'bun') => ({
    name,
    version: undefined,
    useCorepack: false,
    installCommand: [name, 'install'] as [string, ...string[]],
    workspaceFiles: WORKSPACE_FILES[name],
    packageManagerField: undefined,
    nearestPackageJson: undefined,
  });

  it.each(['npm', 'pnpm'] as const)(
    'injects ignore-scripts=true into .npmrc for %s when ignoreScripts is set',
    (name) => {
      copyWorkspaceFiles(srcDir, destDir, makeInfo(name), [], true);
      const npmrc = fs.readFileSync(path.join(destDir, '.npmrc'), 'utf8');
      expect(npmrc).toContain('ignore-scripts=true');
    },
  );

  it('injects enableScripts: false into .yarnrc.yml for yarn when ignoreScripts is set', () => {
    copyWorkspaceFiles(srcDir, destDir, makeInfo('yarn'), [], true);
    const yarnrc = fs.readFileSync(path.join(destDir, '.yarnrc.yml'), 'utf8');
    expect(yarnrc).toContain('enableScripts: false');
  });

  it('is a no-op for bun when ignoreScripts is set', () => {
    copyWorkspaceFiles(srcDir, destDir, makeInfo('bun'), [], true);
    expect(fs.existsSync(path.join(destDir, '.npmrc'))).toBe(false);
    expect(fs.existsSync(path.join(destDir, '.yarnrc.yml'))).toBe(false);
  });

  it('appends ignore-scripts to an existing .npmrc without a trailing newline', () => {
    fs.writeFileSync(path.join(srcDir, '.npmrc'), 'registry=https://example.test');
    copyWorkspaceFiles(srcDir, destDir, makeInfo('npm'), [], true);
    const npmrc = fs.readFileSync(path.join(destDir, '.npmrc'), 'utf8');
    expect(npmrc).toContain('registry=https://example.test');
    expect(npmrc).toContain('\nignore-scripts=true');
  });

  it('does not duplicate ignore-scripts when already present', () => {
    fs.writeFileSync(path.join(srcDir, '.npmrc'), 'ignore-scripts=true\n');
    copyWorkspaceFiles(srcDir, destDir, makeInfo('npm'), [], true);
    const npmrc = fs.readFileSync(path.join(destDir, '.npmrc'), 'utf8');
    expect(npmrc.match(/ignore-scripts=true/g)).toHaveLength(1);
  });

  it('throws when a pnpm patch path escapes the project/output directory', () => {
    const workspaceContent = [
      'packages: []',
      'patchedDependencies:',
      '  "constructs@3.22.4": ../../escape.patch',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), workspaceContent);

    expect(() => copyWorkspaceFiles(srcDir, destDir, makeInfo('pnpm'), ['constructs'])).toThrow(
      /resolves outside/,
    );
  });

  it('throws when a pnpm patch path is a symlink that escapes the project root', () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-outside-'));
    try {
      fs.writeFileSync(path.join(outsideDir, 'evil.patch'), 'diff');
      fs.mkdirSync(path.join(srcDir, 'patches'));
      fs.symlinkSync(
        path.join(outsideDir, 'evil.patch'),
        path.join(srcDir, 'patches/constructs.patch'),
      );

      const workspaceContent = [
        'packages: []',
        'patchedDependencies:',
        '  "constructs@3.22.4": patches/constructs.patch',
      ].join('\n');
      fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), workspaceContent);

      expect(() => copyWorkspaceFiles(srcDir, destDir, makeInfo('pnpm'), ['constructs'])).toThrow(
        /via symlink/,
      );
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('skips files that do not exist in projectRoot', () => {
    const info = {
      name: 'yarn' as const,
      version: undefined,
      useCorepack: false,
      installCommand: ['yarn', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.yarn,
      packageManagerField: undefined,
      nearestPackageJson: undefined,
    };
    copyWorkspaceFiles(srcDir, destDir, info);
    expect(fs.readdirSync(destDir)).toHaveLength(0);
  });

  it('strips patchedDependencies entries for packages not in nodeModules', () => {
    const workspaceContent = [
      'packages: []',
      'patchedDependencies:',
      '  "@changesets/cli@2.31.0": patches/@changesets__cli@2.31.0.patch',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), workspaceContent);
    fs.mkdirSync(path.join(srcDir, 'patches'));
    fs.writeFileSync(path.join(srcDir, 'patches/@changesets__cli@2.31.0.patch'), 'diff');

    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
      nearestPackageJson: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo, ['constructs']);

    const written = fs.readFileSync(path.join(destDir, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).not.toContain('patchedDependencies');
    expect(fs.existsSync(path.join(destDir, 'patches'))).toBe(false);
  });

  it('ignores packages not in nodeModules even when yaml has non-standard content', () => {
    const workspaceContent = [
      'packages: []',
      'patchedDependencies:',
      '  not-a-valid-entry',
      '  "@changesets/cli@2.31.0": patches/@changesets__cli@2.31.0.patch',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), workspaceContent);

    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
      nearestPackageJson: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo, ['constructs']);

    const written = fs.readFileSync(path.join(destDir, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).not.toContain('patchedDependencies');
  });

  it('skips copying a patch file that does not exist on disk', () => {
    const workspaceContent = [
      'packages: []',
      'patchedDependencies:',
      '  "constructs@3.22.4": patches/constructs@3.22.4.patch',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), workspaceContent);
    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
      nearestPackageJson: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo, ['constructs']);

    const written = fs.readFileSync(path.join(destDir, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).toContain('constructs@3.22.4');
    expect(fs.existsSync(path.join(destDir, 'patches/constructs@3.22.4.patch'))).toBe(false);
  });

  it('preserves patchedDependencies entries for packages in nodeModules and copies their patch files', () => {
    const workspaceContent = [
      'packages: []',
      'patchedDependencies:',
      '  "constructs@3.22.4": patches/constructs@3.22.4.patch',
      '  "@changesets/cli@2.31.0": patches/@changesets__cli@2.31.0.patch',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), workspaceContent);
    fs.mkdirSync(path.join(srcDir, 'patches'));
    fs.writeFileSync(path.join(srcDir, 'patches/constructs@3.22.4.patch'), 'diff --constructs');
    fs.writeFileSync(path.join(srcDir, 'patches/@changesets__cli@2.31.0.patch'), 'diff --cs');

    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
      nearestPackageJson: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo, ['constructs']);

    const written = fs.readFileSync(path.join(destDir, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).toContain('patchedDependencies');
    expect(written).toContain('constructs@3.22.4');
    expect(written).not.toContain('@changesets/cli@2.31.0');
    expect(fs.existsSync(path.join(destDir, 'patches/constructs@3.22.4.patch'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'patches/@changesets__cli@2.31.0.patch'))).toBe(false);
  });
});

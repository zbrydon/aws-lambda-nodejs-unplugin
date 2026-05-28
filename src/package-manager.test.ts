import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LockFile,
  WORKSPACE_FILES,
  copyWorkspaceFiles,
  detectPackageManager,
  isCorepackAvailable,
} from './package-manager.ts';

vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  return { ...original, spawnSync: vi.fn<typeof original.spawnSync>(original.spawnSync) };
});

const spawnSyncMock = vi.mocked(spawnSync);

// ---------------------------------------------------------------------------
// isCorepackAvailable
// ---------------------------------------------------------------------------
describe('isCorepackAvailable', () => {
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
});

// ---------------------------------------------------------------------------
// detectPackageManager
// ---------------------------------------------------------------------------
describe('detectPackageManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
    // Default corepack: not available
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
    expect(info.lockFile).toBe(LockFile.PNPM);
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
    expect(info.lockFile).toBe(LockFile.YARN);
  });

  it('detects npm from packageManager field', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'npm@10.0.0' }),
    );
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('npm');
    expect(info.lockFile).toBe(LockFile.NPM);
  });

  it('detects bun from packageManager field', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'bun@1.0.0' }),
    );
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('bun');
    expect(info.lockFile).toBe(LockFile.BUN_LOCK);
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

  it('detects bun from bun.lockb and sets lockFile to bun.lockb', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('bun');
    expect(info.lockFile).toBe(LockFile.BUN);
  });

  it('detects npm from package-lock.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '');
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('npm');
  });

  it('defaults to npm when nothing found', () => {
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('npm');
    expect(info.version).toBeUndefined();
  });

  it('ignores packageManager field with unknown pm name', () => {
    // Only npm|yarn|pnpm|bun are matched; unknown ones fall through to lockfile/default
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'unknown@1.0.0' }),
    );
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('npm'); // fallback
  });

  it('uses bun.lockb when packageManager field is bun and only bun.lockb is present', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'bun@1.0.0' }),
    );
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('bun');
    expect(info.lockFile).toBe(LockFile.BUN);
  });

  it('pnpm install command uses --no-frozen-lockfile (not --no-prefer-frozen-lockfile)', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const info = detectPackageManager(tmpDir);
    expect(info.installCommand).toContain('--no-frozen-lockfile');
    expect(info.installCommand).not.toContain('--no-prefer-frozen-lockfile');
  });

  it('npm install command is "npm ci" when package-lock.json is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('npm');
    expect(info.installCommand).toContain('ci');
    expect(info.installCommand).not.toContain('install');
  });

  it('npm fallback uses "npm install" (not "npm ci") when no lock file is present', () => {
    // No lock file → npm fallback path. npm ci requires package-lock.json and
    // would fail; the command must be npm install instead.
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
    // 'rush' is not a known PM; should fall through and detect pnpm from lock file.
    const info = detectPackageManager(tmpDir);
    expect(info.name).toBe('pnpm');
  });

  it('falls through to npm default when package.json contains non-object JSON', () => {
    // A package.json that is valid JSON but not an object (e.g. an array) should be
    // treated as absent so lock-file / npm-default detection takes over.
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
    // workspaceFiles must be iterable; TypeError if WORKSPACE_FILES['rush'] were used.
    expect(() =>
      info.workspaceFiles.forEach(() => {
        /* noop */
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// copyWorkspaceFiles
// ---------------------------------------------------------------------------
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

    detectPackageManager(srcDir); // will be npm (no lock), but we override
    // Build a fake info for pnpm
    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      lockFile: LockFile.PNPM,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo);

    expect(fs.existsSync(path.join(destDir, 'pnpm-workspace.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, '.npmrc'))).toBe(true);
    // .pnpmfile.cjs didn't exist in src; should not be created in dest
    expect(fs.existsSync(path.join(destDir, '.pnpmfile.cjs'))).toBe(false);
  });

  it('skips files that do not exist in projectRoot', () => {
    const info = {
      name: 'yarn' as const,
      version: undefined,
      useCorepack: false,
      lockFile: LockFile.YARN,
      installCommand: ['yarn', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.yarn,
      packageManagerField: undefined,
    };
    copyWorkspaceFiles(srcDir, destDir, info);
    // No files in srcDir; destDir remains empty
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

    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from(
        JSON.stringify({
          '@changesets/cli@2.31.0': path.join(srcDir, 'patches/@changesets__cli@2.31.0.patch'),
        }),
      ),
      stderr: Buffer.from(''),
      signal: null,
    });

    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      lockFile: LockFile.PNPM,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo, ['zod']);

    const written = fs.readFileSync(path.join(destDir, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).not.toContain('patchedDependencies');
    expect(fs.existsSync(path.join(destDir, 'patches'))).toBe(false);
  });

  it('ignores packages not in nodeModules even when yaml has non-standard content', () => {
    // pnpm config get parses the YAML itself; only valid entries appear in its output
    const workspaceContent = [
      'packages: []',
      'patchedDependencies:',
      '  not-a-valid-entry',
      '  "@changesets/cli@2.31.0": patches/@changesets__cli@2.31.0.patch',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), workspaceContent);

    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from(
        JSON.stringify({
          '@changesets/cli@2.31.0': path.join(srcDir, 'patches/@changesets__cli@2.31.0.patch'),
        }),
      ),
      stderr: Buffer.from(''),
      signal: null,
    });

    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      lockFile: LockFile.PNPM,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo, ['zod']);

    const written = fs.readFileSync(path.join(destDir, 'pnpm-workspace.yaml'), 'utf8');
    // @changesets/cli is not in nodeModules=['zod']
    expect(written).not.toContain('patchedDependencies');
  });

  it('skips copying a patch file that does not exist on disk', () => {
    const workspaceContent = [
      'packages: []',
      'patchedDependencies:',
      '  "zod@3.22.4": patches/zod@3.22.4.patch',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), workspaceContent);
    // Intentionally do NOT create the patch file in srcDir

    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from(
        JSON.stringify({ 'zod@3.22.4': path.join(srcDir, 'patches/zod@3.22.4.patch') }),
      ),
      stderr: Buffer.from(''),
      signal: null,
    });

    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      lockFile: LockFile.PNPM,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo, ['zod']);

    const written = fs.readFileSync(path.join(destDir, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).toContain('zod@3.22.4');
    // Patch file doesn't exist in src, so it should not appear in dest either
    expect(fs.existsSync(path.join(destDir, 'patches/zod@3.22.4.patch'))).toBe(false);
  });

  it('returns original content when pnpm config get fails', () => {
    const workspaceContent = [
      'packages: []',
      'patchedDependencies:',
      '  "zod@3.22.4": patches/zod@3.22.4.patch',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), workspaceContent);

    spawnSyncMock.mockReturnValueOnce({
      status: 1,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from('error'),
      signal: null,
    });

    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      lockFile: LockFile.PNPM,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo, ['zod']);

    const written = fs.readFileSync(path.join(destDir, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).toBe(workspaceContent);
  });

  it('strips patchedDependencies when pnpm config get returns non-object JSON', () => {
    const workspaceContent = [
      'packages: []',
      'patchedDependencies:',
      '  "zod@3.22.4": patches/zod@3.22.4.patch',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), workspaceContent);

    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from('null'),
      stderr: Buffer.from(''),
      signal: null,
    });

    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      lockFile: LockFile.PNPM,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo, ['zod']);

    const written = fs.readFileSync(path.join(destDir, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).not.toContain('patchedDependencies');
  });

  it('returns original content when pnpm config get output is not valid JSON', () => {
    const workspaceContent = [
      'packages: []',
      'patchedDependencies:',
      '  "zod@3.22.4": patches/zod@3.22.4.patch',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), workspaceContent);

    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from('not valid json {{{'),
      stderr: Buffer.from(''),
      signal: null,
    });

    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      lockFile: LockFile.PNPM,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo, ['zod']);

    const written = fs.readFileSync(path.join(destDir, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).toBe(workspaceContent);
  });

  it('skips patch entries whose value is not a string', () => {
    const workspaceContent = [
      'packages: []',
      'patchedDependencies:',
      '  "zod@3.22.4": patches/zod@3.22.4.patch',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), workspaceContent);

    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from(JSON.stringify({ 'zod@3.22.4': 42 })),
      stderr: Buffer.from(''),
      signal: null,
    });

    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      lockFile: LockFile.PNPM,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo, ['zod']);

    const written = fs.readFileSync(path.join(destDir, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).not.toContain('patchedDependencies');
  });

  it('preserves patchedDependencies entries for packages in nodeModules and copies their patch files', () => {
    const workspaceContent = [
      'packages: []',
      'patchedDependencies:',
      '  "zod@3.22.4": patches/zod@3.22.4.patch',
      '  "@changesets/cli@2.31.0": patches/@changesets__cli@2.31.0.patch',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, 'pnpm-workspace.yaml'), workspaceContent);
    fs.mkdirSync(path.join(srcDir, 'patches'));
    fs.writeFileSync(path.join(srcDir, 'patches/zod@3.22.4.patch'), 'diff --zod');
    fs.writeFileSync(path.join(srcDir, 'patches/@changesets__cli@2.31.0.patch'), 'diff --cs');

    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from(
        JSON.stringify({
          'zod@3.22.4': path.join(srcDir, 'patches/zod@3.22.4.patch'),
          '@changesets/cli@2.31.0': path.join(srcDir, 'patches/@changesets__cli@2.31.0.patch'),
        }),
      ),
      stderr: Buffer.from(''),
      signal: null,
    });

    const pnpmInfo = {
      name: 'pnpm' as const,
      version: undefined,
      useCorepack: false,
      lockFile: LockFile.PNPM,
      installCommand: ['pnpm', 'install'] as [string, ...string[]],
      workspaceFiles: WORKSPACE_FILES.pnpm,
      packageManagerField: undefined,
    };

    copyWorkspaceFiles(srcDir, destDir, pnpmInfo, ['zod']);

    const written = fs.readFileSync(path.join(destDir, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).toContain('patchedDependencies');
    expect(written).toContain('zod@3.22.4');
    expect(written).not.toContain('@changesets/cli@2.31.0');
    expect(fs.existsSync(path.join(destDir, 'patches/zod@3.22.4.patch'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'patches/@changesets__cli@2.31.0.patch'))).toBe(false);
  });
});

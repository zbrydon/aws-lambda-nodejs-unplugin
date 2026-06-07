import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ValidationError } from './errors.ts';
import { isRecord, parseJsonFile } from './util.ts';

export type PackageManagerName = 'npm' | 'yarn' | 'pnpm' | 'bun';

enum LockFile {
  NPM = 'package-lock.json',
  YARN = 'yarn.lock',
  BUN = 'bun.lockb',
  BUN_LOCK = 'bun.lock',
  PNPM = 'pnpm-lock.yaml',
}

const KNOWN_PM_NAMES: ReadonlySet<string> = new Set<PackageManagerName>([
  'npm',
  'yarn',
  'pnpm',
  'bun',
]);

const isPackageManagerName = (value: unknown): value is PackageManagerName =>
  typeof value === 'string' && KNOWN_PM_NAMES.has(value);

const LOCK_FILE_PM: [string, PackageManagerName][] = [
  [LockFile.PNPM, 'pnpm'],
  [LockFile.YARN, 'yarn'],
  [LockFile.BUN_LOCK, 'bun'],
  [LockFile.BUN, 'bun'],
  [LockFile.NPM, 'npm'],
];

export const LOCK_FILE_NAMES: string[] = LOCK_FILE_PM.map(([file]) => file);

export const lockFilePackageManager = (fileName: string): PackageManagerName | undefined =>
  LOCK_FILE_PM.find(([file]) => file === fileName)?.[1];

export const WORKSPACE_FILES: Record<PackageManagerName, string[]> = {
  pnpm: ['pnpm-workspace.yaml', '.npmrc', '.pnpmfile.cjs', '.pnpmfile.mjs'],
  yarn: ['.yarnrc.yml', '.npmrc'],
  npm: ['.npmrc'],
  bun: ['bunfig.toml', '.npmrc'],
};

export interface PackageManagerInfo {
  name: PackageManagerName;
  version: string | undefined;
  useCorepack: boolean;
  installCommand: [string, ...string[]];
  workspaceFiles: string[];
  packageManagerField: string | undefined;
  nearestPackageJson: string | undefined;
}

const COREPACK_PROBE_TIMEOUT_MS = 5000;

let corepackAvailableCache: boolean | undefined;

export const resetCorepackCache = (): void => {
  corepackAvailableCache = undefined;
};

export const isCorepackAvailable = (): boolean => {
  if (corepackAvailableCache !== undefined) {
    return corepackAvailableCache;
  }
  const result = spawnSync('corepack', ['--version'], {
    encoding: 'utf8',
    timeout: COREPACK_PROBE_TIMEOUT_MS,
  });

  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
    return false;
  }
  corepackAvailableCache = !result.error && result.status === 0;
  return corepackAvailableCache;
};

const isInside = (parent: string, child: string): boolean => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Yields the package.json paths between `startDir` and `projectRoot` (inclusive),
 * nearest first. In a monorepo the leaf package (nearest the handler) is honored
 * before the repo root, so a `packageManager` / `devEngines` field declared in a
 * sub-package is not missed. When `startDir` is not inside `projectRoot` (e.g. an
 * explicit projectRoot was passed), only `projectRoot` is considered.
 */
function* packageJsonChain(startDir: string, projectRoot: string): Generator<string> {
  const root = path.resolve(projectRoot);
  const start = path.resolve(startDir);

  if (!isInside(root, start)) {
    yield path.join(root, 'package.json');
    return;
  }

  let dir = start;
  while (dir !== root) {
    yield path.join(dir, 'package.json');
    dir = path.dirname(dir);
  }
  yield path.join(root, 'package.json');
}

/**
 * Detect the package manager for a given project root directory.
 *
 * Detection order:
 *   1. `package.json#packageManager` (corepack field), nearest package first
 *   2. `package.json#devEngines.packageManager`, nearest package first
 *   3. The already-discovered lock file (`lockFilePath`), else a lock file in
 *      `projectRoot`
 *   4. npm fallback
 *
 * Lock discovery and package-manager detection are anchored to the same root:
 * pass the lock file resolved by `findLockFile` as `options.lockFilePath` so
 * step 3 agrees with it, and `options.startDir` (the directory of the handler
 * entry) so steps 1-2 walk up from the leaf package rather than inspecting only
 * `projectRoot`.
 */
export const detectPackageManager = (
  projectRoot: string,
  options: { lockFilePath?: string; startDir?: string; ignoreScripts?: boolean } = {},
): PackageManagerInfo => {
  const { lockFilePath, startDir = process.cwd(), ignoreScripts = false } = options;

  const lockPmName = lockFilePath ? lockFilePackageManager(path.basename(lockFilePath)) : undefined;

  let nearestPackageJson: string | undefined;
  const info = (
    name: PackageManagerName,
    version?: string,
    useCorepack = false,
    packageManagerField?: string,
  ): PackageManagerInfo =>
    buildInfo({
      name,
      version,
      useCorepack,
      packageManagerField,
      projectRoot,
      ignoreScripts,
      lockFilePath,
      nearestPackageJson,
    });

  const assertLockConsistent = (
    name: PackageManagerName,
    source: string,
    pkgPath: string,
  ): void => {
    if (lockPmName && name !== lockPmName) {
      throw new ValidationError(
        `Package manager mismatch: ${source} in ${pkgPath} selects '${name}', but the ` +
          `resolved lock file ${lockFilePath} is a '${lockPmName}' lock file. Running ` +
          `'${name}' against a '${lockPmName}' lock file would ignore or rewrite it. ` +
          `Reconcile the field with the lock file, or pass an explicit \`depsLockFilePath\` ` +
          `for '${name}'.`,
      );
    }
  };

  for (const pkgPath of packageJsonChain(startDir, projectRoot)) {
    if (!fs.existsSync(pkgPath)) {
      continue;
    }
    nearestPackageJson ??= pkgPath;
    const parsed: unknown = parseJsonFile(pkgPath);
    if (!isRecord(parsed)) {
      continue;
    }

    if (typeof parsed.packageManager === 'string') {
      const m = parsed.packageManager.match(/^(npm|yarn|pnpm|bun)@([^\s+]+)/);
      if (m) {
        const name = m[1] as PackageManagerName;
        assertLockConsistent(name, 'the `packageManager` field', pkgPath);
        return info(name, m[2], isCorepackAvailable(), parsed.packageManager);
      }
    }

    if (isRecord(parsed.devEngines)) {
      const devEnginesPm = parsed.devEngines.packageManager;
      if (isRecord(devEnginesPm) && isPackageManagerName(devEnginesPm.name)) {
        const name = devEnginesPm.name;
        assertLockConsistent(name, 'the `devEngines.packageManager` field', pkgPath);
        const version = typeof devEnginesPm.version === 'string' ? devEnginesPm.version : undefined;
        return info(name, version);
      }
    }
  }

  if (lockPmName) {
    return info(lockPmName);
  }

  for (const [lockFile, pmName] of LOCK_FILE_PM) {
    if (fs.existsSync(path.join(projectRoot, lockFile))) {
      return info(pmName);
    }
  }

  return info('npm');
};

const buildInstallCommand = (
  name: PackageManagerName,
  useCorepack: boolean,
  projectRoot: string,
  ignoreScripts: boolean,
  lockFilePath: string | undefined,
): [string, ...string[]] => {
  const runner: [string, ...string[]] = useCorepack ? ['corepack', name] : [name];

  switch (name) {
    case 'pnpm':
      return [
        ...runner,
        'install',
        '--config.node-linker=hoisted',
        '--config.package-import-method=clone-or-copy',
        '--no-frozen-lockfile',
      ];
    case 'yarn':
      return [...runner, 'install', '--no-immutable'];
    case 'bun':
      return [
        ...runner,
        'install',
        '--backend',
        'copyfile',
        ...(ignoreScripts ? ['--ignore-scripts'] : []),
      ];
    default: {
      const willCopyNpmLock = lockFilePath
        ? fs.existsSync(lockFilePath) && path.basename(lockFilePath) === LockFile.NPM
        : fs.existsSync(path.join(projectRoot, LockFile.NPM));
      return willCopyNpmLock ? [...runner, 'ci'] : [...runner, 'install'];
    }
  }
};

interface BuildInfoArgs {
  name: PackageManagerName;
  version: string | undefined;
  useCorepack: boolean;
  packageManagerField: string | undefined;
  projectRoot: string;
  ignoreScripts: boolean;
  lockFilePath: string | undefined;
  nearestPackageJson: string | undefined;
}

const buildInfo = ({
  name,
  version,
  useCorepack,
  packageManagerField,
  projectRoot,
  ignoreScripts,
  lockFilePath,
  nearestPackageJson,
}: BuildInfoArgs): PackageManagerInfo => ({
  name,
  version,
  useCorepack,
  installCommand: buildInstallCommand(name, useCorepack, projectRoot, ignoreScripts, lockFilePath),
  workspaceFiles: WORKSPACE_FILES[name],
  packageManagerField,
  nearestPackageJson,
});

const injectIgnoreScripts = (outputDir: string, pm: PackageManagerInfo): void => {
  const ensureLine = (file: string, key: RegExp, line: string): void => {
    const target = path.join(outputDir, file);
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (key.test(existing)) {
      return;
    }
    const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(target, `${existing}${sep}${line}\n`);
  };

  switch (pm.name) {
    case 'npm':
    case 'pnpm':
      ensureLine('.npmrc', /^ignore-scripts\s*=/m, 'ignore-scripts=true');
      break;
    case 'yarn':
      ensureLine('.yarnrc.yml', /^enableScripts\s*:/m, 'enableScripts: false');
      break;
    case 'bun':
      break;
  }
};

const filterPnpmWorkspaceYaml = (
  content: string,
  nodeModules: string[],
  projectRoot: string,
  outputDir: string,
): { content: string; copiedFiles: string[] } => {
  const sectionMatch = content.match(/^(patchedDependencies:\n)((?:[ \t]+[^\n]*\n?)*)/m);
  if (!sectionMatch) {
    return { content, copiedFiles: [] };
  }

  const fullMatch = sectionMatch[0];
  const header = sectionMatch[1] as string;
  const sectionBody = sectionMatch[2] as string;

  const entryPattern = /^[ \t]+['"]?([^'":\n]+)['"]?:[ \t]+(.+)$/gm;
  const relevantEntries: [string, string][] = [];
  let m: RegExpExecArray | null;
  while ((m = entryPattern.exec(sectionBody)) !== null) {
    const pkgKey = (m[1] as string).trim();
    const relativePath = (m[2] as string).trim();
    const pkgName = pkgKey.replace(/@\d[^@]*$/, '');
    if (nodeModules.includes(pkgName)) {
      relevantEntries.push([pkgKey, relativePath]);
    }
  }

  const copiedFiles: string[] = [];
  for (const [, relativePath] of relevantEntries) {
    const src = path.join(projectRoot, relativePath);
    const dest = path.join(outputDir, relativePath);

    if (!isInside(projectRoot, src) || !isInside(outputDir, dest)) {
      throw new ValidationError(
        `Refusing to copy pnpm patch '${relativePath}': it resolves outside the project root or output directory.`,
      );
    }
    if (!fs.existsSync(src)) {
      continue;
    }

    const realSrc = fs.realpathSync(src);
    if (!isInside(fs.realpathSync(projectRoot), realSrc)) {
      throw new ValidationError(
        `Refusing to copy pnpm patch '${relativePath}': it resolves (via symlink) outside the project root.`,
      );
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(realSrc, dest);
    copiedFiles.push(dest);
  }

  if (relevantEntries.length === 0) {
    return { content: content.replace(fullMatch, ''), copiedFiles };
  }

  const newLines = relevantEntries.map(([key, val]) => `  '${key}': ${val}`);
  return { content: content.replace(fullMatch, `${header}${newLines.join('\n')}\n`), copiedFiles };
};

export const copyWorkspaceFiles = (
  projectRoot: string,
  outputDir: string,
  pm: PackageManagerInfo,
  nodeModules: string[] = [],
  ignoreScripts = false,
): string[] => {
  const stagedFiles: string[] = [];
  for (const file of pm.workspaceFiles) {
    const src = path.join(projectRoot, file);
    if (!fs.existsSync(src)) {
      continue;
    }
    const dest = path.join(outputDir, file);
    if (pm.name === 'pnpm' && file === 'pnpm-workspace.yaml') {
      const content = fs.readFileSync(src, 'utf8');
      const filtered = filterPnpmWorkspaceYaml(content, nodeModules, projectRoot, outputDir);
      fs.writeFileSync(dest, filtered.content);
      stagedFiles.push(...filtered.copiedFiles);
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  if (ignoreScripts) {
    injectIgnoreScripts(outputDir, pm);
  }

  return stagedFiles;
};

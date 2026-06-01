import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isRecord } from './util.ts';

export type PackageManagerName = 'npm' | 'yarn' | 'pnpm' | 'bun';

export enum LockFile {
  NPM = 'package-lock.json',
  YARN = 'yarn.lock',
  BUN = 'bun.lockb',
  BUN_LOCK = 'bun.lock',
  PNPM = 'pnpm-lock.yaml',
}

/** Known package manager names, used for validation of devEngines entries. */
const KNOWN_PM_NAMES = new Set<PackageManagerName>(['npm', 'yarn', 'pnpm', 'bun']);

/** Type guard that narrows an unknown value to PackageManagerName. */
const isPackageManagerName = (value: unknown): value is PackageManagerName =>
  typeof value === 'string' && KNOWN_PM_NAMES.has(value as PackageManagerName);

/** Ordered list: first match wins. */
const LOCK_FILE_PM: [string, PackageManagerName][] = [
  [LockFile.PNPM, 'pnpm'],
  [LockFile.YARN, 'yarn'],
  [LockFile.BUN_LOCK, 'bun'],
  [LockFile.BUN, 'bun'],
  [LockFile.NPM, 'npm'],
];

/** Lock-file names in precedence order. Single source for lock-file discovery. */
export const LOCK_FILE_NAMES: string[] = LOCK_FILE_PM.map(([file]) => file);

/** Workspace-config files to copy from the source repo into the asset output dir. */
export const WORKSPACE_FILES: Record<PackageManagerName, string[]> = {
  pnpm: ['pnpm-workspace.yaml', '.npmrc', '.pnpmfile.cjs', '.pnpmfile.mjs'],
  yarn: ['.yarnrc.yml', '.npmrc'],
  npm: ['.npmrc'],
  bun: ['bunfig.toml', '.npmrc'],
};

export interface PackageManagerInfo {
  /** Package manager name. */
  name: PackageManagerName;
  /** Pinned version, if resolved from packageManager / devEngines. */
  version: string | undefined;
  /** Whether corepack is on PATH and the pm was detected via packageManager field. */
  useCorepack: boolean;
  /**
   * The canonical lock-file name for this pm (used to copy into the output dir).
   */
  lockFile: string;
  /** Fully-resolved install command argv (binary + args). */
  installCommand: [string, ...string[]];
  /** Workspace config files to copy into the output dir. */
  workspaceFiles: string[];
  /**
   * The original `packageManager` string (e.g. `"pnpm@9.0.0"`) to write into
   * the output package.json so corepack activates correctly.
   */
  packageManagerField: string | undefined;
}

/** Returns true when corepack is available on PATH. */
export const isCorepackAvailable = (): boolean => {
  const result = spawnSync('corepack', ['--version'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
};

/**
 * Detect the package manager for a given project root directory.
 *
 * Detection order:
 *   1. `package.json#packageManager` (corepack field)
 *   2. `package.json#devEngines.packageManager`
 *   3. Lock file present in `projectRoot`
 *   4. npm fallback
 */
export const detectPackageManager = (projectRoot: string): PackageManagerInfo => {
  const pkgPath = path.join(projectRoot, 'package.json');

  if (fs.existsSync(pkgPath)) {
    const parsed: unknown = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    if (isRecord(parsed)) {
      // 1. packageManager field (e.g. "pnpm@9.0.0")
      if (typeof parsed.packageManager === 'string') {
        const m = parsed.packageManager.match(/^(npm|yarn|pnpm|bun)@([^\s+]+)/);
        if (m) {
          // Safe cast: the regex /^(npm|yarn|pnpm|bun)@/ guarantees m[1] is a
          // PackageManagerName. TypeScript cannot narrow regex capture groups beyond
          // string | undefined.
          const name = m[1] as PackageManagerName;
          const version = m[2];
          const corepack = isCorepackAvailable();
          return buildInfo(name, version, corepack, parsed.packageManager, projectRoot);
        }
      }

      // 2. devEngines.packageManager
      if (isRecord(parsed.devEngines)) {
        const devEnginesPm = parsed.devEngines.packageManager;
        if (isRecord(devEnginesPm) && isPackageManagerName(devEnginesPm.name)) {
          const name = devEnginesPm.name;
          const version =
            typeof devEnginesPm.version === 'string' ? devEnginesPm.version : undefined;
          return buildInfo(name, version, false, undefined, projectRoot);
        }
      }
    }
  }

  // 3. Lockfile detection
  for (const [lockFile, pmName] of LOCK_FILE_PM) {
    if (fs.existsSync(path.join(projectRoot, lockFile))) {
      return buildInfo(pmName, undefined, false, undefined, projectRoot);
    }
  }

  // 4. Fallback
  return buildInfo('npm', undefined, false, undefined, projectRoot);
};

const getLockFile = (name: PackageManagerName, projectRoot: string): string => {
  switch (name) {
    case 'yarn':
      return LockFile.YARN;
    case 'pnpm':
      return LockFile.PNPM;
    case 'bun':
      // Prefer the text lock file (bun.lock); fall back to the binary one (bun.lockb).
      if (fs.existsSync(path.join(projectRoot, LockFile.BUN_LOCK))) {
        return LockFile.BUN_LOCK;
      }
      if (fs.existsSync(path.join(projectRoot, LockFile.BUN))) {
        return LockFile.BUN;
      }
      // Neither present (e.g. bun came from the packageManager field): default to
      // the modern text lock file name.
      return LockFile.BUN_LOCK;
    default:
      return LockFile.NPM;
  }
};

const buildInstallCommand = (
  name: PackageManagerName,
  useCorepack: boolean,
  projectRoot: string,
): [string, ...string[]] => {
  // When corepack is active, prefix with "corepack <pm>" so the pinned
  // version declared in the output package.json is honoured.
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
      return [...runner, 'install', '--backend', 'copyfile'];
    default: {
      // Use `npm ci` only when package-lock.json is present; it requires the
      // lock file and will fail when npm was detected via the fallback path
      // (no lock file found). Fall back to `npm install` in that case.
      // Assumes the lock file copied into the install dir is package-lock.json,
      // which holds whenever npm is the detected package manager.
      const hasLockFile = fs.existsSync(path.join(projectRoot, LockFile.NPM));
      return hasLockFile ? [...runner, 'ci'] : [...runner, 'install'];
    }
  }
};

const buildInfo = (
  name: PackageManagerName,
  version: string | undefined,
  useCorepack: boolean,
  packageManagerField: string | undefined,
  projectRoot: string,
): PackageManagerInfo => ({
  name,
  version,
  useCorepack,
  lockFile: getLockFile(name, projectRoot),
  installCommand: buildInstallCommand(name, useCorepack, projectRoot),
  workspaceFiles: WORKSPACE_FILES[name],
  packageManagerField,
});

/**
 * Filters pnpm-workspace.yaml content to only include patchedDependencies
 * entries for packages in nodeModules. Relevant patch files are copied to
 * outputDir. Entries for packages not being installed are stripped to avoid
 * ERR_PNPM_UNUSED_PATCH.
 *
 * This is an intentionally line-oriented matcher targeting the flat
 * `patchedDependencies:` block pnpm writes; it is not a general YAML parser and
 * does not handle nested or flow-style content.
 */
const filterPnpmWorkspaceYaml = (
  content: string,
  nodeModules: string[],
  projectRoot: string,
  outputDir: string,
): string => {
  const sectionMatch = content.match(/^(patchedDependencies:\n)((?:[ \t]+[^\n]*\n?)*)/m);
  if (!sectionMatch) {
    return content;
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

  for (const [, relativePath] of relevantEntries) {
    const src = path.join(projectRoot, relativePath);
    if (!fs.existsSync(src)) {
      continue;
    }
    const dest = path.join(outputDir, relativePath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  if (relevantEntries.length === 0) {
    return content.replace(fullMatch, '');
  }

  const newLines = relevantEntries.map(([key, val]) => `  '${key}': ${val}`);
  return content.replace(fullMatch, `${header}${newLines.join('\n')}\n`);
};

/**
 * Copy workspace config files (e.g. pnpm-workspace.yaml, .npmrc) from
 * `projectRoot` into `outputDir`, skipping any that don't exist.
 */
export const copyWorkspaceFiles = (
  projectRoot: string,
  outputDir: string,
  pm: PackageManagerInfo,
  nodeModules: string[] = [],
): void => {
  for (const file of pm.workspaceFiles) {
    const src = path.join(projectRoot, file);
    if (!fs.existsSync(src)) {
      continue;
    }
    const dest = path.join(outputDir, file);
    if (pm.name === 'pnpm' && file === 'pnpm-workspace.yaml') {
      const content = fs.readFileSync(src, 'utf8');
      fs.writeFileSync(dest, filterPnpmWorkspaceYaml(content, nodeModules, projectRoot, outputDir));
    } else {
      fs.copyFileSync(src, dest);
    }
  }
};

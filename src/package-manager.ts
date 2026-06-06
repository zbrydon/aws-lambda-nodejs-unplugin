import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ValidationError } from './errors.ts';
import { isRecord, parseJsonFile } from './util.ts';

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

/** Maps a lock-file name to the package manager that produces it. */
export const lockFilePackageManager = (fileName: string): PackageManagerName | undefined =>
  LOCK_FILE_PM.find(([file]) => file === fileName)?.[1];

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

/** Bounded timeout for the `corepack --version` availability probe (ms). */
const COREPACK_PROBE_TIMEOUT_MS = 5000;

/**
 * Memoized corepack availability. The probe spawns a subprocess and its result
 * cannot change within a synth, so it is computed once per process rather than
 * per `NodejsFunction`. A hung corepack shim is bounded by the probe timeout.
 */
let corepackAvailableCache: boolean | undefined;

/** Resets the memoized corepack availability. Test-only. */
export const resetCorepackCache = (): void => {
  corepackAvailableCache = undefined;
};

/** Returns true when corepack is available on PATH. Result is memoized. */
export const isCorepackAvailable = (): boolean => {
  if (corepackAvailableCache !== undefined) {
    return corepackAvailableCache;
  }
  const result = spawnSync('corepack', ['--version'], {
    encoding: 'utf8',
    timeout: COREPACK_PROBE_TIMEOUT_MS,
  });
  corepackAvailableCache = !result.error && result.status === 0;
  return corepackAvailableCache;
};

/** True when `child` resolves to a path at or below `parent`. */
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

  // start is at or below root, so walking up via dirname is guaranteed to reach
  // root; yield each directory from the leaf up to (and including) root.
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

  for (const pkgPath of packageJsonChain(startDir, projectRoot)) {
    if (!fs.existsSync(pkgPath)) {
      continue;
    }
    const parsed: unknown = parseJsonFile(pkgPath);
    if (!isRecord(parsed)) {
      continue;
    }

    if (typeof parsed.packageManager === 'string') {
      const m = parsed.packageManager.match(/^(npm|yarn|pnpm|bun)@([^\s+]+)/);
      if (m) {
        const name = m[1] as PackageManagerName;
        const version = m[2];
        const corepack = isCorepackAvailable();
        return buildInfo(
          name,
          version,
          corepack,
          parsed.packageManager,
          projectRoot,
          ignoreScripts,
        );
      }
    }

    if (isRecord(parsed.devEngines)) {
      const devEnginesPm = parsed.devEngines.packageManager;
      if (isRecord(devEnginesPm) && isPackageManagerName(devEnginesPm.name)) {
        const name = devEnginesPm.name;
        const version = typeof devEnginesPm.version === 'string' ? devEnginesPm.version : undefined;
        return buildInfo(name, version, false, undefined, projectRoot, ignoreScripts);
      }
    }
  }

  if (lockFilePath) {
    const match = LOCK_FILE_PM.find(([lockFile]) => lockFile === path.basename(lockFilePath));
    if (match) {
      return buildInfo(match[1], undefined, false, undefined, projectRoot, ignoreScripts);
    }
  }

  for (const [lockFile, pmName] of LOCK_FILE_PM) {
    if (fs.existsSync(path.join(projectRoot, lockFile))) {
      return buildInfo(pmName, undefined, false, undefined, projectRoot, ignoreScripts);
    }
  }

  return buildInfo('npm', undefined, false, undefined, projectRoot, ignoreScripts);
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
  ignoreScripts: boolean,
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
      // Unlike npm/pnpm/yarn, bun has no config-file switch for lifecycle
      // scripts (and is not "safe by default" - it runs scripts for its
      // built-in trusted list and the most popular packages), so suppress them
      // with the install flag instead. See injectIgnoreScripts.
      return [
        ...runner,
        'install',
        '--backend',
        'copyfile',
        ...(ignoreScripts ? ['--ignore-scripts'] : []),
      ];
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
  ignoreScripts: boolean,
): PackageManagerInfo => ({
  name,
  version,
  useCorepack,
  lockFile: getLockFile(name, projectRoot),
  installCommand: buildInstallCommand(name, useCorepack, projectRoot, ignoreScripts),
  workspaceFiles: WORKSPACE_FILES[name],
  packageManagerField,
});

/**
 * When `ignoreScripts` is requested, disable lifecycle scripts during the
 * isolated install by writing the relevant setting into the staged
 * package-manager config (these config files are stripped from the asset after
 * install, so the setting never ships at runtime).
 */
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
      // No-op: bun has no config-file switch for lifecycle scripts, so the
      // suppression is applied via the `--ignore-scripts` install flag in
      // buildInstallCommand rather than a staged config file.
      break;
  }
};

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
    const dest = path.join(outputDir, relativePath);
    // A `../`-prefixed relativePath in pnpm-workspace.yaml would read from outside
    // projectRoot and write outside outputDir. Author-controlled, but bound it so
    // a stray entry cannot escape the staged asset directory.
    if (!isInside(projectRoot, src) || !isInside(outputDir, dest)) {
      throw new ValidationError(
        `Refusing to copy pnpm patch '${relativePath}': it resolves outside the project root or output directory.`,
      );
    }
    if (!fs.existsSync(src)) {
      continue;
    }
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
  ignoreScripts = false,
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

  if (ignoreScripts) {
    injectIgnoreScripts(outputDir, pm);
  }
};

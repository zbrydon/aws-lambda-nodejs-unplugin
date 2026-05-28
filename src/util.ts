import * as fs from 'fs';
import { createRequire } from 'node:module';
import * as path from 'path';
import { ValidationError } from './errors.ts';

export interface CallSite {
  getThis(): unknown;
  getTypeName(): string | null;
  getFunctionName(): string | null;
  getMethodName(): string;
  getFileName(): string;
  getLineNumber(): number;
  getColumnNumber(): number;
  getFunction(): (...args: unknown[]) => unknown;
  getEvalOrigin(): string;
  isNative(): boolean;
  isToplevel(): boolean;
  isEval(): boolean;
  isConstructor(): boolean;
}

/** Narrows an unknown value to a plain (non-array) object record. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validates that an item from Error.prepareStackTrace has the expected CallSite shape. */
export const isCallSite = (item: unknown): item is CallSite => {
  if (!isRecord(item)) {
    return false;
  }
  // Route through unknown before casting to CallSite: Record<string,unknown> and
  // CallSite share no structural overlap that TypeScript can verify, so a direct
  // cast is rejected. The runtime checks above confirm the required methods exist.
  const site = item as unknown as CallSite;
  return typeof site.getFileName === 'function' && typeof site.getFunctionName === 'function';
};

/**
 * Get callsites from the V8 stack trace API.
 * https://github.com/sindresorhus/callsites
 */
export const callsites = (): CallSite[] => {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- static property, not an instance method; `this` is irrelevant
  const _prepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stack) => stack;
  // With prepareStackTrace overridden, V8 sets Error.stack to the return value of
  // the callback — a NodeJS.CallSite[] — rather than the usual formatted string.
  // TypeScript still types Error.stack as string | undefined; annotate as unknown
  // and validate the shape before returning.
  const stack: unknown = new Error().stack;
  Error.prepareStackTrace = _prepareStackTrace;
  /* c8 ignore next 3 -- V8 always returns an array via prepareStackTrace; guard is defensive */
  if (!Array.isArray(stack)) {
    return [];
  }
  return stack.slice(1).filter(isCallSite);
};

/** Find a file by walking up parent directories. */
export const findUp = (name: string, directory: string = process.cwd()): string | undefined =>
  findUpMultiple([name], directory)[0];

/**
 * Find the lowest occurrence of any of the given names by walking up parent
 * directories. If multiple names exist at the same level, all are returned.
 */
export const findUpMultiple = (names: string[], directory: string = process.cwd()): string[] => {
  const absoluteDirectory = path.resolve(directory);

  const files: string[] = [];
  for (const name of names) {
    const file = path.join(absoluteDirectory, name);
    if (fs.existsSync(file)) {
      files.push(file);
    }
  }

  if (files.length > 0) {
    return files;
  }

  const { root } = path.parse(absoluteDirectory);
  if (absoluteDirectory === root) {
    return [];
  }

  return findUpMultiple(names, path.dirname(absoluteDirectory));
};

/** Returns true when value is an object whose every value is a string — i.e. a dependency map. */
const isDependencySection = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((v) => typeof v === 'string');

const tryGetModuleVersionFromPkg = (
  mod: string,
  pkgJson: Record<string, unknown>,
  pkgPath: string,
): string | undefined => {
  // Spread order: peerDependencies (lowest priority) → devDependencies →
  // dependencies (highest priority). A pinned version in `dependencies` must
  // not be overwritten by the broader range typically found in `peerDependencies`.
  // Each section is validated before spreading; malformed / non-object sections are ignored.
  const dependencies: Record<string, string> = {
    ...(isDependencySection(pkgJson.peerDependencies) ? pkgJson.peerDependencies : {}),
    ...(isDependencySection(pkgJson.devDependencies) ? pkgJson.devDependencies : {}),
    ...(isDependencySection(pkgJson.dependencies) ? pkgJson.dependencies : {}),
  };

  const version = dependencies[mod];
  if (version === undefined) {
    return undefined;
  }
  // An empty or blank version (e.g. a hand-edited package.json with `"pkg": ""`)
  // would silently fall through to the require-based fallback and resolve
  // whatever version happens to be installed.  Fail loudly instead.
  if (!version.trim()) {
    throw new ValidationError(
      `Found an empty version string for '${mod}' in ${pkgPath}. ` +
        `Please set a valid version in your package.json.`,
    );
  }

  // Resolve file: specifiers to absolute paths.
  const filePart = version.match(/^file:(.+)$/)?.[1];
  if (filePart !== undefined && !path.isAbsolute(filePart)) {
    return `file:${path.join(path.dirname(pkgPath), filePart)}`;
  }

  return version;
};

const tryGetModuleVersionFromRequire = (mod: string, fromDir: string): string | undefined => {
  try {
    // Anchor module resolution to `fromDir` (the directory containing the
    // entry package.json), not process.cwd(). In a monorepo the two differ
    // and anchoring to cwd() could resolve the wrong version or fail entirely
    // for packages installed locally inside a sub-package.
    // createRequire works in both CJS and ESM output; the plain require()
    // global is unavailable in ESM bundles (dist/index.mjs).
    const _require = createRequire(path.join(fromDir, 'package.json'));
    const pkg: unknown = _require(`${mod}/package.json`);
    // The required package.json may be any shape; validate before reading version.
    if (isRecord(pkg) && typeof pkg.version === 'string') {
      return pkg.version;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Extract pinned versions for a list of modules from the caller's package.json,
 * falling back to `require('<mod>/package.json').version` for transitive deps.
 */
export const extractDependencies = (pkgPath: string, modules: string[]): Record<string, string> => {
  const result: Record<string, string> = {};
  const parsed: unknown = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!isRecord(parsed)) {
    throw new ValidationError(`${pkgPath} does not contain a valid JSON object.`);
  }
  const pkgJson = parsed;

  for (const mod of modules) {
    const version =
      tryGetModuleVersionFromPkg(mod, pkgJson, pkgPath) ??
      tryGetModuleVersionFromRequire(mod, path.dirname(pkgPath));

    if (!version) {
      throw new ValidationError(
        `Cannot extract version for module '${mod}'. Check that it's referenced in your package.json or installed.`,
      );
    }

    result[mod] = version;
  }

  return result;
};

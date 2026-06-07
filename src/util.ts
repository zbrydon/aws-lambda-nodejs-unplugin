import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { ValidationError } from './errors.ts';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read and parse a JSON file, rethrowing malformed JSON as a ValidationError so
 * callers surface a consistent, file-attributed error rather than a raw
 * SyntaxError.
 */
export const parseJsonFile = (filePath: string): unknown => {
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    // JSON.parse only ever throws a SyntaxError, so reading `.message` is safe.
    throw new ValidationError(`Failed to parse ${filePath} as JSON: ${(err as Error).message}`);
  }
};

export const findUp = (name: string, directory: string = process.cwd()): string | undefined =>
  findUpMultiple([name], directory)[0];

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

const isDependencySection = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((v) => typeof v === 'string');

const tryGetModuleVersionFromPkg = (
  mod: string,
  pkgJson: Record<string, unknown>,
  pkgPath: string,
): string | undefined => {
  const dependencies: Record<string, string> = {
    ...(isDependencySection(pkgJson.peerDependencies) ? pkgJson.peerDependencies : {}),
    ...(isDependencySection(pkgJson.devDependencies) ? pkgJson.devDependencies : {}),
    ...(isDependencySection(pkgJson.dependencies) ? pkgJson.dependencies : {}),
  };

  const version = dependencies[mod];
  if (version === undefined) {
    return undefined;
  }

  if (!version.trim()) {
    throw new ValidationError(
      `Found an empty version string for '${mod}' in ${pkgPath}. ` +
        `Please set a valid version in your package.json.`,
    );
  }

  const fileMatch = version.match(/^file:(.*)$/);
  if (fileMatch) {
    const filePart = (fileMatch[1] as string).trim();
    if (!filePart) {
      throw new ValidationError(
        `Found a 'file:' dependency with an empty path for '${mod}' in ${pkgPath}. ` +
          `Please point it at a valid path in your package.json.`,
      );
    }
    if (!path.isAbsolute(filePart)) {
      return `file:${path.join(path.dirname(pkgPath), filePart)}`;
    }
    return `file:${filePart}`;
  }

  if (/^(workspace|link|catalog):/.test(version)) {
    return undefined;
  }

  return version;
};

const tryGetModuleVersionFromRequire = (mod: string, fromDir: string): string | undefined => {
  try {
    const _require = createRequire(path.join(fromDir, 'package.json'));
    const pkg: unknown = _require(`${mod}/package.json`);
    if (isRecord(pkg) && typeof pkg.version === 'string') {
      return pkg.version;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

export const extractDependencies = (pkgPath: string, modules: string[]): Record<string, string> => {
  const result: Record<string, string> = {};
  const parsed: unknown = parseJsonFile(pkgPath);
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

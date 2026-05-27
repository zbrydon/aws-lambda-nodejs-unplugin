import * as fs from 'fs';
import { fileURLToPath } from 'node:url';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';
import { Bundling } from './bundling.ts';
import { ValidationError } from './errors.ts';
import { LockFile } from './package-manager.ts';
import type { BundlingOptions } from './types.ts';
import { callsites, findUpMultiple } from './util.ts';

export interface NodejsFunctionProps extends lambda.FunctionOptions {
  /**
   * Path to the handler entry file (JS or TS).
   *
   * If omitted, the entry is derived from the file that calls
   * `new NodejsFunction(...)` and the construct id:
   *   `<defining-file>.<id>.(ts|js|mjs|mts|cts|cjs)`
   *
   * Relative paths are resolved against the process working directory.
   */
  readonly entry?: string;

  /**
   * Exported handler function name.
   * @default 'handler'
   */
  readonly handler?: string;

  /**
   * Lambda runtime. Must be a NODEJS family runtime.
   * @default lambda.Runtime.NODEJS_LATEST
   */
  readonly runtime?: lambda.Runtime;

  /**
   * Path to the dependencies lock file.
   * @default - located by walking up from the entry file
   */
  readonly depsLockFilePath?: string;

  /**
   * Project root directory (must contain the lock file).
   * @default - parent directory of `depsLockFilePath`
   */
  readonly projectRoot?: string;

  /** Bundling options. Required. */
  readonly bundling: BundlingOptions;
}

/**
 * A Lambda function whose source is bundled by the user's chosen bundler
 * (esbuild, vite, rollup, webpack, rspack, or farm) via unplugin.
 *
 * Drop-in replacement for `aws_lambda_nodejs.NodejsFunction`.
 */
export class NodejsFunction extends lambda.Function {
  constructor(scope: Construct, id: string, props: NodejsFunctionProps) {
    if (props.runtime && props.runtime.family !== lambda.RuntimeFamily.NODEJS) {
      throw new ValidationError('Only NODEJS runtimes are supported.');
    }

    const runtime = props.runtime ?? lambda.Runtime.NODEJS_LATEST;
    const architecture = props.architecture ?? lambda.Architecture.X86_64;

    const entry = path.resolve(findEntry(id, props.entry));
    const depsLockFilePath = findLockFile(props.depsLockFilePath);
    const projectRoot = path.resolve(props.projectRoot ?? path.dirname(depsLockFilePath));
    const handler = props.handler ?? 'handler';

    super(scope, id, {
      ...props,
      runtime,
      code: Bundling.bundle(scope, {
        ...props.bundling,
        entry,
        runtime,
        architecture,
        depsLockFilePath,
        projectRoot,
      }),
      handler: handler.includes('.') ? handler : `index.${handler}`,
    });
  }
}

const LOCK_FILES = [LockFile.PNPM, LockFile.YARN, LockFile.BUN_LOCK, LockFile.BUN, LockFile.NPM];

const findLockFile = (depsLockFilePath?: string): string => {
  if (depsLockFilePath) {
    if (!fs.existsSync(depsLockFilePath)) {
      throw new ValidationError(`Lock file at ${depsLockFilePath} doesn't exist.`);
    }
    if (!fs.statSync(depsLockFilePath).isFile()) {
      throw new ValidationError('`depsLockFilePath` should point to a file.');
    }
    return path.resolve(depsLockFilePath);
  }

  const lockFiles = findUpMultiple(LOCK_FILES);
  if (lockFiles.length === 0) {
    throw new ValidationError(
      'Cannot find a package lock file. Please specify it with `depsLockFilePath`.',
    );
  }
  if (lockFiles.length > 1) {
    throw new ValidationError(
      `Multiple package lock files found: ${lockFiles.join(', ')}. Please specify the desired one with \`depsLockFilePath\`.`,
    );
  }
  // lockFiles.length === 1 is guaranteed by the checks above; noUncheckedIndexedAccess
  // requires the assertion since TypeScript cannot infer length from runtime guards.
  return lockFiles[0] as string;
};

const ENTRY_EXTENSIONS = ['.ts', '.js', '.mjs', '.mts', '.cts', '.cjs'];

const findEntry = (id: string, entry?: string): string => {
  if (entry) {
    if (!/\.(jsx?|tsx?|cjs|cts|mjs|mts)$/.test(entry)) {
      throw new ValidationError('Only JavaScript or TypeScript entry files are supported.');
    }
    if (!fs.existsSync(entry)) {
      throw new ValidationError(`Cannot find entry file at ${entry}.`);
    }
    return entry;
  }

  const definingFile = findDefiningFile();
  const extname = path.extname(definingFile);

  for (const ext of ENTRY_EXTENSIONS) {
    // Use a replacer function so special replacement sequences ($&, $', etc.)
    // inside `id` are never interpreted by String.prototype.replace.
    const candidate = definingFile.replace(
      new RegExp(`${escapeRegExp(extname)}$`),
      () => `.${id}${ext}`,
    );
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const tried = ENTRY_EXTENSIONS.map((ext) =>
    definingFile.replace(new RegExp(`${escapeRegExp(extname)}$`), () => `.${id}${ext}`),
  ).join(', ');

  throw new ValidationError(`Cannot find handler file. Tried: ${tried}`);
};

const findDefiningFile = (): string => {
  const sites = callsites();
  let definingIndex: number | undefined;

  for (const [index, site] of sites.entries()) {
    if (site.getFunctionName() === 'NodejsFunction') {
      // The NodejsFunction constructor runs before its own super() call, so
      // `this` is in the temporal dead zone and getTypeName() returns null for
      // that frame.  Starting the walk one frame later, we then skip any
      // subclass constructor frames that are also in a super() chain
      // (identifiable by getTypeName() === null && isConstructor() === true;
      // their `this` is similarly uninitialised).  The first frame that doesn't
      // match those criteria is the actual call site where
      // `new NodejsFunction(...)` or `new SubClass(...)` was written.
      let depth = index + 1;
      // Skip frames that are in the super()-call chain of a derived class: their
      // `this` is uninitialised, so getTypeName() === null && isConstructor() === true.
      while (
        depth < sites.length &&
        sites[depth]?.getTypeName() === null &&
        sites[depth]?.isConstructor()
      ) {
        depth++;
      }
      // Also skip factory-wrapper frames: a non-constructor, null-type frame
      // sitting between NodejsFunction and the real CDK construct constructor.
      // We only advance one layer; the common pattern is a single factory
      // function; nested factories require an explicit `entry`.
      if (
        depth + 1 < sites.length &&
        sites[depth]?.getTypeName() === null &&
        !sites[depth]?.isConstructor() &&
        sites[depth + 1]?.isConstructor() &&
        sites[depth + 1]?.getTypeName() !== null
      ) {
        depth++;
      }
      definingIndex = depth;
      break;
    }
  }

  if (definingIndex === undefined) {
    throw new ValidationError('Cannot find defining file.');
  }

  const definingFile = sites[definingIndex];

  const fileName = definingFile?.getFileName();

  if (!fileName) {
    throw new ValidationError('Cannot find defining file.');
  }

  // Normalise file:// URLs added by ESM loaders.  fileURLToPath handles
  // Windows drive letters (file:///C:/...) correctly; a plain regex strip
  // would leave a leading slash that path.resolve cannot interpret on Windows.
  if (fileName.startsWith('file://')) {
    return fileURLToPath(fileName);
  }
  return fileName;
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';
import { Bundling } from './bundling.ts';
import { ValidationError } from './errors.ts';
import { LOCK_FILE_NAMES, lockFilePackageManager } from './package-manager.ts';
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
   *
   * Auto-detection assumes `new NodejsFunction(...)` is called directly from your
   * construct/stack, or wrapped by at most one synchronous factory frame inside a
   * construct constructor. A top-level or asynchronous factory wrapper resolves
   * the entry relative to the wrong file; pass `entry` explicitly in that case.
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
   * @default - located by walking up parent directories from the current working directory
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
    const bundlerConfig = findBundlerConfig(props.bundling.bundlerConfig, projectRoot);

    const handlerFn = resolveHandlerFn(props.handler);

    super(scope, id, {
      ...props,
      runtime,
      code: Bundling.bundle({
        ...props.bundling,
        bundlerConfig,
        entry,
        runtime,
        architecture,
        depsLockFilePath,
        projectRoot,
      }),
      handler: `index.${handlerFn}`,
    });
  }
}

/**
 * Resolve the exported handler function name.
 *
 * Every bridge emits the bundle as a single `index.js`, so only the exported
 * function name is meaningful and the Lambda handler is always `index.<fn>`.
 * Lambda splits a handler on the LAST dot (everything before is the module path,
 * everything after is the export), so any `file.` / `path/file.` prefix the
 * caller supplies can only point at a file that does not exist in the asset and
 * is discarded. The remaining segment is validated as a JS identifier so a
 * malformed handler fails at synth time rather than with a runtime
 * `ImportModuleError`.
 */
const resolveHandlerFn = (handler?: string): string => {
  const handlerName = (handler ?? 'handler').trim();
  const handlerFn = handlerName.slice(handlerName.lastIndexOf('.') + 1);
  if (!/^[A-Za-z_$][\w$]*$/.test(handlerFn)) {
    throw new ValidationError(
      `Invalid handler '${handler}'. Expected an exported function name, optionally prefixed with a file part (e.g. 'handler' or 'index.handler').`,
    );
  }
  return handlerFn;
};

// Resolve the bundler config to an absolute path (relative paths are resolved
// against projectRoot) and verify it exists at synth time. Without this the
// missing file only surfaces as an opaque "bridge exited with status 1" from the
// spawned subprocess that import()s it.
const findBundlerConfig = (bundlerConfig: string, projectRoot: string): string => {
  const resolved = path.isAbsolute(bundlerConfig)
    ? bundlerConfig
    : path.resolve(projectRoot, bundlerConfig);
  if (!fs.existsSync(resolved)) {
    throw new ValidationError(`Cannot find bundler config at ${resolved}.`);
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new ValidationError(`Bundler config path ${resolved} is not a file.`);
  }
  return resolved;
};

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

  const lockFiles = findUpMultiple(LOCK_FILE_NAMES);
  if (lockFiles.length === 0) {
    throw new ValidationError(
      'Cannot find a package lock file. Please specify it with `depsLockFilePath`.',
    );
  }
  // Multiple lock files at the same level are ambiguous only when they belong to
  // different package managers. Variants of one manager commonly coexist (e.g.
  // bun.lock + bun.lockb during a bun migration), so collapse those and select by
  // precedence rather than erroring.
  if (lockFiles.length > 1) {
    const managers = new Set(lockFiles.map((f) => lockFilePackageManager(path.basename(f))));
    if (managers.size > 1) {
      throw new ValidationError(
        `Multiple package lock files found: ${lockFiles.join(', ')}. Please specify the desired one with \`depsLockFilePath\`.`,
      );
    }
  }
  // One file, or several variants of the same manager: take the first.
  // findUpMultiple iterates LOCK_FILE_NAMES (precedence-ordered) within a single
  // directory, so lockFiles is already precedence-ordered; [0] is the
  // highest-precedence match and is defined per the non-empty guard above.
  return lockFiles[0] as string;
};

const ENTRY_EXTENSIONS = ['.ts', '.js', '.mjs', '.mts', '.cts', '.cjs'];

const findEntry = (id: string, entry?: string): string => {
  if (entry) {
    // Keep the accepted extensions in lock-step with ENTRY_EXTENSIONS so an
    // explicitly-passed entry and an auto-detected one support the same set.
    if (!/\.(js|ts|mjs|mts|cts|cjs)$/.test(entry)) {
      throw new ValidationError('Only JavaScript or TypeScript entry files are supported.');
    }
    if (!fs.existsSync(entry)) {
      throw new ValidationError(`Cannot find entry file at ${entry}.`);
    }
    if (!fs.statSync(entry).isFile()) {
      throw new ValidationError(`Entry path ${entry} is not a file.`);
    }
    return entry;
  }

  const definingFile = findDefiningFile();
  const extname = path.extname(definingFile);
  const extPattern = new RegExp(`${escapeRegExp(extname)}$`);

  // Use a replacer function so special replacement sequences ($&, $', etc.)
  // inside `id` are never interpreted by String.prototype.replace.
  const candidates = ENTRY_EXTENSIONS.map((ext) =>
    definingFile.replace(extPattern, () => `.${id}${ext}`),
  );

  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (match) {
    return match;
  }

  throw new ValidationError(`Cannot find handler file. Tried: ${candidates.join(', ')}`);
};

// Normalise file:// URLs added by ESM loaders. fileURLToPath handles Windows
// drive letters (file:///C:/...) correctly; a plain regex strip would leave a
// leading slash that path.resolve cannot interpret on Windows.
const normalizeFileName = (fileName: string): string =>
  fileName.startsWith('file://') ? fileURLToPath(fileName) : fileName;

const findDefiningFile = (): string => {
  const sites = callsites();
  let definingIndex: number | undefined;
  let ownFile: string | undefined;
  // True when the entry is derived from a factory-wrapper frame rather than the
  // immediate caller of `new NodejsFunction(...)`. Used to warn below, since
  // that is the one path that can silently resolve the wrong sibling file.
  let skippedFactoryFrame = false;

  for (const [index, site] of sites.entries()) {
    if (site.getFunctionName() === 'NodejsFunction') {
      // The NodejsFunction frame lives in this package's own module; remember it
      // so an over/under-skipped frame that lands back here is caught below.
      ownFile = site.getFileName() ?? undefined;
      // Start one frame after NodejsFunction itself; skip super()-chain frames
      // (getTypeName() === null && isConstructor()) to reach the real call site.
      let depth = index + 1;
      while (
        depth < sites.length &&
        sites[depth]?.getTypeName() === null &&
        sites[depth]?.isConstructor()
      ) {
        depth++;
      }
      // Skip one factory-wrapper frame (null type, non-constructor) between
      // NodejsFunction and the CDK construct constructor.
      if (
        depth + 1 < sites.length &&
        sites[depth]?.getTypeName() === null &&
        !sites[depth]?.isConstructor() &&
        sites[depth + 1]?.isConstructor() &&
        sites[depth + 1]?.getTypeName() !== null
      ) {
        depth++;
        skippedFactoryFrame = true;
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

  const resolved = normalizeFileName(fileName);

  // If resolution lands back on this package's own module, frame-skipping has
  // failed (e.g. a non-synchronous or multi-level factory wrapper) and the
  // derived entry would be wrong. Fail loudly instead of emitting a bad path.
  if (ownFile && normalizeFileName(ownFile) === resolved) {
    throw new ValidationError(
      'Could not auto-detect the handler entry: resolution pointed back at ' +
        'aws-lambda-nodejs-unplugin itself. This happens when `new NodejsFunction(...)` ' +
        'is not called directly from your construct/stack (e.g. wrapped by a factory). ' +
        'Pass `entry` explicitly.',
    );
  }

  // The entry was derived by skipping a factory-wrapper frame, so it came from a
  // frame that is not the immediate caller. The own-module guard above rules out
  // landing back in this package, but a same-named sibling file next to the
  // wrapper can still pass plausibility and be bundled by mistake. Surface a
  // non-fatal warning so a wrong pick is visible rather than silent.
  if (skippedFactoryFrame) {
    process.emitWarning(
      `Auto-detected the handler entry "${resolved}" by looking past a factory ` +
        'wrapper around `new NodejsFunction(...)`, not its immediate caller. If this ' +
        'is the wrong file, pass `entry` explicitly.',
    );
  }

  return resolved;
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

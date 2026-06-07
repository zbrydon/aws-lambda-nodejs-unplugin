import * as fs from 'node:fs';
import * as path from 'node:path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';
import { Bundling } from './bundling.ts';
import { ValidationError } from './errors.ts';
import { LOCK_FILE_NAMES, lockFilePackageManager } from './package-manager.ts';
import type { BundlingOptions } from './types.ts';
import { findUpMultiple } from './util.ts';

export interface NodejsFunctionProps extends lambda.FunctionOptions {
  /**
   * Path to the handler entry file (JS or TS).
   * Relative paths are resolved against the process working directory.
   */
  readonly entry: string;

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

    const entry = validateEntry(props.entry);
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

const validateEntry = (entry: string): string => {
  if (!/\.(js|ts|mjs|mts|cts|cjs)$/.test(entry)) {
    throw new ValidationError('Only JavaScript or TypeScript entry files are supported.');
  }
  const resolved = path.resolve(entry);
  if (!fs.existsSync(resolved)) {
    throw new ValidationError(`Cannot find entry file at ${resolved}.`);
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new ValidationError(`Entry path ${resolved} is not a file.`);
  }
  return resolved;
};

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

  if (lockFiles.length > 1) {
    const managers = new Set(lockFiles.map((f) => lockFilePackageManager(path.basename(f))));
    if (managers.size > 1) {
      throw new ValidationError(
        `Multiple package lock files found: ${lockFiles.join(', ')}. Please specify the desired one with \`depsLockFilePath\`.`,
      );
    }
  }

  return lockFiles[0] as string;
};

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ILocalBundling } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import type { Architecture, AssetCode, Runtime } from 'aws-cdk-lib/aws-lambda';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { getBundler } from './bundlers/index.ts';
import { ValidationError } from './errors.ts';
import { copyWorkspaceFiles, detectPackageManager } from './package-manager.ts';
import type { BundlingOptions } from './types.ts';
import { extractDependencies, findUp, isRecord } from './util.ts';

export interface BundlingProps extends BundlingOptions {
  entry: string;
  runtime: Runtime;
  architecture: Architecture;
  depsLockFilePath: string;
  projectRoot: string;
}

/** Human-readable description of how a spawned process terminated. */
const describeExit = (result: { signal: NodeJS.Signals | null; status: number | null }): string =>
  result.signal != null
    ? `killed by signal ${result.signal}`
    : `exited with status ${result.status}`;

/**
 * CDK bundling implementation that delegates to the user-supplied bundler.
 *
 * Implements `cdk.BundlingOptions` so it can be passed directly to
 * `lambda.Code.fromAsset({ bundling: ... })`. Docker bundling is not
 * supported; `local.tryBundle` always returns true.
 */
export class Bundling implements cdk.BundlingOptions {
  static bundle(props: BundlingProps): AssetCode {
    return lambda.Code.fromAsset(props.projectRoot, {
      assetHash: props.assetHash,
      assetHashType: props.assetHash ? cdk.AssetHashType.CUSTOM : cdk.AssetHashType.OUTPUT,
      bundling: new Bundling(props),
    });
  }

  /** Dummy Docker image. Local bundling always succeeds; Docker is never used. */
  public readonly image: cdk.DockerImage;
  public readonly local: ILocalBundling;

  constructor(private readonly props: BundlingProps) {
    this.image = cdk.DockerImage.fromRegistry('dummy');
    this.local = this.buildLocalBundling();
  }

  private buildLocalBundling(): ILocalBundling {
    const { props } = this;

    return {
      tryBundle: (outputDir: string): boolean => {
        const adapter = getBundler(props.bundler);

        // 1. beforeBundling hooks
        for (const cmd of props.commandHooks?.beforeBundling(props.projectRoot, outputDir) ?? []) {
          this.shell(cmd, props.projectRoot);
        }

        // 2. Spawn the pre-built bridge script for this bundler.
        // The bridge lives in dist/bridges/ inside this package's node_modules entry,
        // so Node's ESM resolver naturally walks up to projectRoot/node_modules and
        // finds the bundler peer deps; no temp file needed.
        const configPath = path.isAbsolute(props.bundlerConfig)
          ? props.bundlerConfig
          : path.resolve(props.projectRoot, props.bundlerConfig);

        const bundleResult = spawnSync(
          'node',
          [adapter.bridgeScriptPath, configPath, props.entry, outputDir],
          {
            env: process.env,
            stdio: ['ignore', 'inherit', 'inherit'],
            cwd: props.projectRoot,
          },
        );

        if (bundleResult.error) {
          throw bundleResult.error;
        }
        if (bundleResult.status !== 0) {
          throw new ValidationError(`Bundler '${props.bundler}' ${describeExit(bundleResult)}.`);
        }

        const metaPath = path.join(outputDir, '.lambda-bundle-meta');
        let isEsm = false;
        if (fs.existsSync(metaPath)) {
          // Always remove the meta file, even if parsing throws, so it never
          // leaks into the bundled asset.
          try {
            const parsed: unknown = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            const format =
              isRecord(parsed) && typeof parsed.format === 'string' ? parsed.format : null;
            isEsm = format === 'esm' || format === 'es';
          } finally {
            fs.unlinkSync(metaPath);
          }
        }

        // 3. Install nodeModules
        if (props.nodeModules?.length) {
          const pm = detectPackageManager(props.projectRoot);

          const pkgJsonPath = findUp('package.json', path.dirname(props.entry));
          if (!pkgJsonPath) {
            throw new ValidationError(
              'Cannot find a package.json. Using nodeModules requires a package.json.',
            );
          }

          // 3a. beforeInstall hooks
          for (const cmd of props.commandHooks?.beforeInstall(props.projectRoot, outputDir) ?? []) {
            this.shell(cmd, props.projectRoot);
          }

          const deps = extractDependencies(pkgJsonPath, props.nodeModules);

          // Write a minimal package.json with optional type for ESM and packageManager for corepack.
          const outputPkg: Record<string, unknown> = { dependencies: deps };
          if (isEsm) {
            outputPkg.type = 'module';
          }
          if (pm.packageManagerField) {
            outputPkg.packageManager = pm.packageManagerField;
          }
          fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(outputPkg));

          // Copy workspace config files so catalog: / workspace: resolve correctly.
          copyWorkspaceFiles(props.projectRoot, outputDir, pm, props.nodeModules);

          // Copy lock file.  Always source from the explicit depsLockFilePath
          // (validated to exist in NodejsFunction) so a non-standard location
          // passed by the caller is honoured rather than silently ignored.
          if (fs.existsSync(props.depsLockFilePath)) {
            fs.copyFileSync(
              props.depsLockFilePath,
              path.join(outputDir, path.basename(props.depsLockFilePath)),
            );
          }

          const [installBin, ...installArgs] = pm.installCommand;
          const installResult = spawnSync(installBin, installArgs, {
            env: process.env,
            stdio: ['ignore', 'inherit', 'inherit'],
            cwd: outputDir,
          });

          if (installResult.error) {
            throw installResult.error;
          }
          if (installResult.status !== 0) {
            throw new ValidationError(
              `Package manager '${pm.name}' install ${describeExit(installResult)}.`,
            );
          }
        }

        // ESM without nodeModules still needs package.json with type: module.
        if (!props.nodeModules?.length && isEsm) {
          fs.writeFileSync(
            path.join(outputDir, 'package.json'),
            JSON.stringify({ type: 'module' }),
          );
        }

        // 4. afterBundling hooks
        for (const cmd of props.commandHooks?.afterBundling(props.projectRoot, outputDir) ?? []) {
          this.shell(cmd, props.projectRoot);
        }

        return true;
      },
    };
  }

  private shell(cmd: string, cwd: string): void {
    const result = spawnSync('bash', ['-c', cmd], {
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd,
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new ValidationError(`Command hook '${cmd}' ${describeExit(result)}.`);
    }
  }
}

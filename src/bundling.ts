import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ILocalBundling } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import type { Architecture, AssetCode, Runtime } from 'aws-cdk-lib/aws-lambda';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { isEsmFormat } from './bridges/write-meta.ts';
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
 * Tail of a captured stderr stream, formatted for appending to a thrown error
 * message. The bridge / install subprocess stderr is captured (piped) and
 * re-emitted to this process's stderr after the subprocess exits, so it scrolls
 * away in the synth output; surfacing the last few lines on the thrown error
 * keeps the real failure reason attached to the generic "exited with status N"
 * message.
 */
const stderrTail = (stderr: string | Buffer | null | undefined, maxLines = 20): string => {
  if (!stderr) {
    return '';
  }
  // spawnSync returns a string when `encoding` is set, a Buffer otherwise.
  const text = typeof stderr === 'string' ? stderr : stderr.toString('utf-8');
  if (!text) {
    return '';
  }
  const tail = text.trimEnd().split('\n').slice(-maxLines).join('\n');
  return tail ? `\n\n${tail}` : '';
};

/**
 * Shared spawnSync result check: re-emit any captured stderr, rethrow a spawn
 * error (e.g. ENOENT), and throw a ValidationError on a non-zero exit. When
 * `tail` is set, the last few stderr lines are appended to the thrown message
 * (only meaningful when stderr was piped rather than inherited).
 */
const checkSpawnResult = (
  result: SpawnSyncReturns<string | Buffer>,
  prefix: string,
  { tail = false }: { tail?: boolean } = {},
): void => {
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new ValidationError(
      `${prefix} ${describeExit(result)}.${tail ? stderrTail(result.stderr) : ''}`,
    );
  }
};

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
            // Capture stderr (rather than inheriting it) so its tail can be
            // attached to the thrown error; it is re-emitted below after exit.
            stdio: ['ignore', 'inherit', 'pipe'],
            cwd: props.projectRoot,
            timeout: props.timeout,
            encoding: 'utf-8',
          },
        );

        checkSpawnResult(bundleResult, `Bundler '${props.bundler}'`, { tail: true });

        const metaPath = path.join(outputDir, '.lambda-bundle-meta');
        let isEsm = false;
        if (fs.existsSync(metaPath)) {
          // Parse failures are surfaced (the meta file is written by this
          // package's own bridges, so corruption is a real fault worth failing
          // on). The `finally` only guarantees cleanup so a malformed meta file
          // never leaks into the bundled asset.
          try {
            const parsed: unknown = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            const format =
              isRecord(parsed) && typeof parsed.format === 'string' ? parsed.format : undefined;
            isEsm = isEsmFormat(format);
          } finally {
            fs.unlinkSync(metaPath);
          }
        }

        // 3. Install nodeModules
        if (props.nodeModules?.length) {
          // Anchor PM detection to the same lock file discovered for projectRoot,
          // and walk up from the handler's directory so a leaf package.json that
          // declares packageManager / devEngines is honored in a monorepo.
          const pm = detectPackageManager(props.projectRoot, {
            lockFilePath: props.depsLockFilePath,
            startDir: path.dirname(props.entry),
            ignoreScripts: props.ignoreScripts,
          });

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

          // Copy workspace config files so catalog: / workspace: resolve correctly,
          // then install, then strip those config files. The copy -> install ->
          // cleanup sequence is wrapped in try/finally because the install-only
          // config files (notably `.npmrc` / `.yarnrc.yml`, which frequently hold
          // registry auth tokens) must never remain in the staged asset even when
          // the install throws.
          let stagedFiles: string[] = [];
          try {
            stagedFiles = copyWorkspaceFiles(
              props.projectRoot,
              outputDir,
              pm,
              props.nodeModules,
              props.ignoreScripts,
            );

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
              stdio: ['ignore', 'inherit', 'pipe'],
              cwd: outputDir,
              timeout: props.timeout,
              encoding: 'utf-8',
            });

            checkSpawnResult(installResult, `Package manager '${pm.name}' install`, { tail: true });
          } finally {
            // Remove the install-only config files now that install is done (or
            // has failed). These are not needed at runtime and may carry secrets,
            // so they must never ship inside the deployed Lambda asset. The same
            // applies to any pnpm patch files staged alongside pnpm-workspace.yaml.
            for (const file of pm.workspaceFiles) {
              fs.rmSync(path.join(outputDir, file), { force: true });
            }
            for (const file of stagedFiles) {
              fs.rmSync(file, { force: true });
            }
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
    // Run through the platform default shell (`shell: true`) so command hooks
    // work on Windows (cmd.exe) as well as POSIX systems, rather than hardcoding
    // `bash`, which is frequently absent on Windows and minimal containers.
    const result = spawnSync(cmd, [], {
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd,
      shell: true,
      timeout: this.props.timeout,
    });
    // stderr is inherited (not piped) here, so there is no captured tail to append.
    checkSpawnResult(result, `Command hook '${cmd}'`);
  }
}

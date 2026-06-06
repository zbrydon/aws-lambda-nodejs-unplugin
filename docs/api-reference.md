# API reference

## `NodejsFunction`

```ts
import { NodejsFunction } from 'aws-lambda-nodejs-unplugin';
```

Extends `lambda.Function`. Drop-in replacement for `aws_lambda_nodejs.NodejsFunction`.

### Constructor

```ts
new NodejsFunction(scope: Construct, id: string, props: NodejsFunctionProps)
```

Throws `ValidationError` if:

- `runtime` is not a NODEJS family runtime.
- `entry` points to a file that does not exist or has an unsupported extension.
- `depsLockFilePath` points to a path that does not exist or is not a file.
- Lock files for different package managers are found during auto-detection (see `depsLockFilePath` below).
- No lock file can be found at all.
- The auto-detected entry file (from the construct id) cannot be found.
- The entry cannot be auto-detected because `new NodejsFunction(...)` is not called directly from your construct/stack (see `entry` below).

---

### `NodejsFunctionProps`

All props from [`lambda.FunctionOptions`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.FunctionOptions.html) are accepted unchanged. The following props are added or modified:

#### `bundling` (required)

```ts
bundling: BundlingOptions;
```

Bundling configuration. See [`BundlingOptions`](#bundlingoptions).

#### `entry`

```ts
entry?: string
```

Path to the handler entry file. Accepts `.ts`, `.js`, `.mjs`, `.mts`, `.cts`, `.cjs`.

Relative paths are resolved from the current working directory (`process.cwd()`).

When omitted, the entry is derived automatically:

1. The file that contains the `new NodejsFunction(...)` call is identified via the V8 call-stack API.
2. The construct `id` is used as the filename stem.
3. Extensions are tried in order: `.ts`, `.js`, `.mjs`, `.mts`, `.cts`, `.cjs`.

Example -- if `appStack.ts` calls `new NodejsFunction(this, 'worker', ...)`, the auto-detected entry is `appStack.worker.ts` (in the same directory).

Auto-detection assumes `new NodejsFunction(...)` is called directly from your construct/stack, or wrapped by at most one synchronous factory frame inside a construct constructor. A top-level or asynchronous factory wrapper resolves the entry relative to the wrong file; pass `entry` explicitly in that case. If resolution would point back into this package, a `ValidationError` is thrown rather than emitting a wrong path.

#### `handler`

```ts
handler?: string  // default: 'handler'
```

Name of the exported handler function.

The bundle is always emitted as a single `index` file (`index.js` for CommonJS, `index.mjs` for ESM), so the Lambda handler is always `index.<functionName>` and only the exported function name matters:

- A bare name is prefixed with `index.`: `handler` becomes `index.handler`.
- Any file/path prefix is discarded and re-anchored to `index.`: `myFile.myFunction` becomes `index.myFunction`.
- The function name must be a valid JavaScript identifier; an empty or malformed handler throws a `ValidationError` at synth time.

#### `runtime`

```ts
runtime?: lambda.Runtime  // default: lambda.Runtime.NODEJS_LATEST
```

Lambda runtime. Must be a NODEJS family runtime (`lambda.RuntimeFamily.NODEJS`).

#### `depsLockFilePath`

```ts
depsLockFilePath?: string
```

Absolute or relative path to the package manager lock file.

When omitted, the lock file is found by walking up parent directories from the current working directory. Lock files are searched in this order of preference: `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, `package-lock.json`. If lock files for **different** package managers are found at the same directory level a `ValidationError` is thrown. Multiple lock variants of a single manager (e.g. `bun.lock` and `bun.lockb` during a migration) are allowed and resolved by the preference order above.

#### `projectRoot`

```ts
projectRoot?: string
```

Root directory of the project. Must contain the lock file. Defaults to the parent directory of `depsLockFilePath`.

---

## `BundlingOptions`

```ts
import type { BundlingOptions } from 'aws-lambda-nodejs-unplugin';
```

#### `bundler` (required)

```ts
bundler: SupportedBundler;
```

Which bundler to use. One of: `'esbuild'`, `'vite'`, `'rollup'`, `'rolldown'`, `'webpack'`, `'rspack'`, `'farm'`.

#### `bundlerConfig` (required)

```ts
bundlerConfig: string;
```

Path to the bundler config file. Absolute or relative to the project root.

The file must export a default configuration object for the chosen bundler. The CDK bundling driver imports this object, merges in the CDK-controlled entry point and output directory, and calls the bundler's JavaScript API.

The config does **not** need to read environment variables or import anything from this package. See [Bundler configs](bundlers.md) for per-bundler examples.

#### `nodeModules`

```ts
nodeModules?: string[]
```

npm packages to install into the Lambda asset directory rather than embed in the bundle. These are useful for packages with native binaries or packages you want to keep separate.

After bundling, the driver:

1. Resolves each package's version from your `package.json` (falling through to the installed `package.json` for transitive deps).
2. Writes a minimal `package.json` with those pinned versions into the output directory.
3. Copies workspace config files and the lock file.
4. Runs the detected package manager's install command.

See [Advanced usage -- nodeModules](advanced.md#nodemodules).

#### `commandHooks`

```ts
commandHooks?: ICommandHooks
```

Shell commands to run at various points in the bundling pipeline. See [`ICommandHooks`](#icommandhooks).

#### `assetHash`

```ts
assetHash?: string
```

Custom asset hash string. When set, CDK uses `AssetHashType.CUSTOM` with this value instead of computing a hash from the bundled output. Useful for deterministic deployments when you want to control when the Lambda asset is considered changed.

#### `timeout`

```ts
timeout?: number
```

Maximum time, in milliseconds, that any single spawned subprocess (the bundler bridge, the package manager install, or a command hook) may run before it is killed and bundling fails. Omit for no timeout.

This is a synth-time guard, unrelated to the Lambda function's runtime `timeout`. Because bundling runs the bundler config, command hooks, and dependency install with full privileges (see [Security / trust model](../README.md#security--trust-model)), a bound here prevents a hung or runaway subprocess from blocking synth indefinitely.

#### `ignoreScripts`

```ts
ignoreScripts?: boolean  // default: false
```

When `true`, disables package lifecycle scripts (e.g. `postinstall`) during the `nodeModules` install, as defense-in-depth against a compromised transitive dependency. Implemented by injecting the relevant setting into the staged package-manager config (`.npmrc` `ignore-scripts=true` for npm/pnpm, `.yarnrc.yml` `enableScripts: false` for yarn); these config files are stripped from the asset after install. For bun (which has no equivalent config switch and is not safe by default, since it runs lifecycle scripts for its built-in trusted list and the most popular packages) the `bun install --ignore-scripts` flag is used instead. Defaults to `false` to match upstream `aws_lambda_nodejs.NodejsFunction` behavior.

---

## `ICommandHooks`

```ts
import type { ICommandHooks } from 'aws-lambda-nodejs-unplugin';
```

```ts
interface ICommandHooks {
  beforeBundling(inputDir: string, outputDir: string): string[];
  afterBundling(inputDir: string, outputDir: string): string[];
  beforeInstall(inputDir: string, outputDir: string): string[];
}
```

Each method receives:

- `inputDir`: the project root directory.
- `outputDir`: the CDK asset staging directory where bundled output will be written.

Return an array of shell command strings. Each runs through the platform default shell (`cmd.exe` on Windows, `/bin/sh` on POSIX), not bash specifically. An empty array skips the hook. Commands run in order.

`beforeInstall` only runs when `nodeModules` is non-empty.

---

## `SupportedBundler`

```ts
import type { SupportedBundler } from 'aws-lambda-nodejs-unplugin';
import { SUPPORTED_BUNDLERS } from 'aws-lambda-nodejs-unplugin';
```

```ts
type SupportedBundler = 'esbuild' | 'vite' | 'rollup' | 'rolldown' | 'webpack' | 'rspack' | 'farm';

const SUPPORTED_BUNDLERS: SupportedBundler[];
```

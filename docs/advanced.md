# Advanced usage

## nodeModules

Some packages cannot or should not be bundled:

- Packages with native binaries (e.g. `sharp`, `canvas`, `better-sqlite3`)
- Packages that are large enough that installing them separately produces a smaller final asset
- Packages you want Lambda Layers to provide

Use `nodeModules` to install these into the output directory rather than embed them.

```ts
new NodejsFunction(this, 'image-processor', {
  bundling: {
    bundler: 'esbuild',
    bundlerConfig: 'build.mjs',
    nodeModules: ['sharp'],
  },
});
```

### What happens

After bundling completes, the driver:

1. Looks up each package in the nearest `package.json` found by walking up from the entry file's directory (`dependencies`, `devDependencies`, or `peerDependencies`). In a monorepo this is the per-package manifest, which may differ from `projectRoot/package.json` used for package-manager detection. Falls back to the installed package's own `package.json` for transitive deps.
2. Writes a minimal `package.json` with those pinned versions into the output directory.
3. Copies workspace config files (e.g. `pnpm-workspace.yaml`, `.npmrc`) so workspace protocols and catalogs resolve correctly.
4. Copies the lock file.
5. Runs the detected package manager's install command.
6. Removes the install-only workspace config files (including `.npmrc` / `.yarnrc.yml`, which may contain registry credentials) from the output directory so they never ship inside the deployed Lambda asset.

### Package manager detection

The driver reads `projectRoot/package.json` and detects the package manager in this order:

1. `packageManager` field (e.g. `"pnpm@9.0.0"`). Also activates corepack if available.
2. `devEngines.packageManager.name` field.
3. Lock file present in `projectRoot` (`pnpm-lock.yaml` > `yarn.lock` > `bun.lock` > `bun.lockb` > `package-lock.json`).
4. Falls back to npm.

Install commands used:

| PM   | Command                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| pnpm | `pnpm install --config.node-linker=hoisted --config.package-import-method=clone-or-copy --no-frozen-lockfile` |
| yarn | `yarn install --no-immutable`                                                                                 |
| bun  | `bun install --backend copyfile`                                                                              |
| npm  | `npm ci` (when `package-lock.json` is present), otherwise `npm install`                                       |

When corepack is active (detected via `corepack --version`) and the `packageManager` field is set, the install command is prefixed with `corepack <pm>` so the pinned version is honoured.

### Making modules external in your bundler config

You must declare `nodeModules` packages as external in your bundler config. The driver handles installation and `package.json` generation after bundling, but does not inject externals automatically -- if you omit the declaration the bundler will embed the package in the bundle as well as installing it.

Each bundler has its own syntax for this. See [Bundler configs -- externals](bundlers.md#externals).

---

## commandHooks

Use `commandHooks` to run shell commands at three points in the bundling pipeline:

```
beforeBundling  ->  [bundler runs]  ->  [nodeModules install]  ->  afterBundling
                                     ^
                                beforeInstall (only when nodeModules is set)
```

```ts
new NodejsFunction(this, 'my-fn', {
  bundling: {
    bundler: 'esbuild',
    bundlerConfig: 'build.mjs',
    nodeModules: ['@prisma/client'],
    commandHooks: {
      beforeBundling(inputDir, outputDir) {
        return [];
      },
      beforeInstall(inputDir, outputDir) {
        // Generate Prisma client before installing
        return [`npx prisma generate --schema=${inputDir}/prisma/schema.prisma`];
      },
      afterBundling(inputDir, outputDir) {
        // Copy generated Prisma engine binaries
        return [`cp -r ${inputDir}/node_modules/.prisma/client ${outputDir}/node_modules/.prisma/`];
      },
    },
  },
});
```

Each method receives `inputDir` (project root) and `outputDir` (CDK asset staging dir) and must return an array of command strings. Return `[]` to skip.

Commands run synchronously through the platform default shell (`cmd.exe` on Windows, `/bin/sh` on POSIX) with the project root as the working directory. A non-zero exit throws a `ValidationError`. A spawn error (e.g. `ENOENT`) also throws.

> **Security note:** bundler config files are imported and command hooks are executed with the full privileges of the synth environment (typically CI, with cloud credentials). Treat both as trusted code. Use the `timeout` bundling option to bound how long any subprocess may run.

---

## Entry file auto-detection

When `entry` is omitted, `NodejsFunction` detects the entry file from the call stack:

1. V8's stack-trace API finds the frame where `NodejsFunction` was called.
2. The caller's file path is used as the base.
3. The construct `id` is appended to form the handler filename.
4. Extensions are tried in order: `.ts`, `.js`, `.mjs`, `.mts`, `.cts`, `.cjs`.

Example directory layout:

```
src/
  stacks/
    appStack.ts         # calls new NodejsFunction(this, 'worker', ...)
    appStack.worker.ts  # auto-detected entry
    appStack.api.ts     # entry for new NodejsFunction(this, 'api', ...)
```

This mirrors the convention used by `aws_lambda_nodejs.NodejsFunction`. Set `entry` explicitly if you prefer a different layout.

---

## assetHash

By default, CDK hashes the contents of the bundled output directory to determine whether the Lambda asset needs to be re-uploaded. This means a change to any source file will produce a new hash and trigger a re-deploy.

Set `assetHash` to a custom string when you want to control this yourself:

```ts
new NodejsFunction(this, 'my-fn', {
  bundling: {
    bundler: 'esbuild',
    bundlerConfig: 'build.mjs',
    assetHash: process.env.GIT_SHA ?? 'dev',
  },
});
```

With a custom hash, CDK skips re-bundling if the hash string has not changed, regardless of actual output content.

---

## Multiple functions, one bundler config

You can share a single bundler config across multiple `NodejsFunction` instances. The CDK bundling driver injects the entry point and output directory into each invocation via `process.argv`, so the same config file is re-used without modification:

```ts
const sharedBundling = {
  bundler: 'esbuild' as const,
  bundlerConfig: 'build.mjs',
};

new NodejsFunction(this, 'api', {
  entry: 'src/handlers/api.ts',
  bundling: sharedBundling,
});

new NodejsFunction(this, 'worker', {
  entry: 'src/handlers/worker.ts',
  bundling: sharedBundling,
});
```

---

## Using with event sources

`NodejsFunction` extends `lambda.Function` and implements `lambda.IFunction`, so it works with all CDK event source constructs and permission methods unchanged:

```ts
const fn = new NodejsFunction(this, 'worker', {
  bundling: { bundler: 'esbuild', bundlerConfig: 'build.mjs' },
});

// SQS event source
fn.addEventSource(
  new aws_lambda_event_sources.SqsEventSource(queue, {
    batchSize: 10,
    reportBatchItemFailures: true,
  }),
);

// Grant permissions
table.grantReadWriteData(fn);
topic.grantPublish(fn);
bucket.grantRead(fn);
```

---

## Monorepos

In a monorepo, set `projectRoot` to the workspace root so the lock file and workspace config files are found:

```ts
new NodejsFunction(this, 'my-fn', {
  entry: 'src/handlers/my-fn.ts',
  depsLockFilePath: '../../pnpm-lock.yaml', // workspace root lock file
  projectRoot: '../..', // workspace root
  bundling: {
    bundler: 'vite',
    bundlerConfig: 'vite.lambda.config.mts',
    nodeModules: ['some-native-dep'],
  },
});
```

The workspace config files (`pnpm-workspace.yaml`, `.npmrc`, etc.) are copied into the output directory so `catalog:` and `workspace:` protocol references resolve correctly during the `nodeModules` install step.

---

## Disabling bundling during tests

CDK supports disabling bundling for specific stacks during synthesis to speed up unit tests. Pass the `aws:cdk:bundling-stacks` context key:

```ts
// In your test
const app = new App({
  context: { 'aws:cdk:bundling-stacks': [] },
});
```

With an empty array, no stack is bundled. The `NodejsFunction` construct still synthesises correctly -- bundling is simply skipped.

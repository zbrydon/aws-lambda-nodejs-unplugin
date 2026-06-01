# Getting started

## Prerequisites

- Node.js >= 24.14.0
- AWS CDK v2 (`aws-cdk-lib >= 2.130.0`, `constructs ^10.0.0`)
- A bundler installed as a dev dependency (see [Bundler configs](bundlers.md))

## Install

```sh
# npm
npm install aws-lambda-nodejs-unplugin

# pnpm
pnpm add aws-lambda-nodejs-unplugin

# yarn
yarn add aws-lambda-nodejs-unplugin
```

## How it works

`NodejsFunction` is a CDK construct that extends `lambda.Function`. When CDK synthesises your stack, it:

1. Reads the config file at `bundlerConfig` (must export a default object).
2. Merges in the CDK-controlled entry point and output directory.
3. Spawns a bridge script with `node` that calls the bundler's JavaScript API with the merged config.
4. Installs any `nodeModules` into the asset directory.
5. Zips the output and uploads it as a Lambda asset.

All bundling is local.

## Step 1: write a bundler config

Pick any supported bundler and write a config file that exports a default configuration object. See [Bundler configs](bundlers.md) for complete examples for every bundler.

Example for esbuild:

```js
// build.mjs
export default {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
};
```

## Step 2: declare `NodejsFunction` in your stack

```ts
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';
import { NodejsFunction } from 'aws-lambda-nodejs-unplugin';

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new NodejsFunction(this, 'my-api', {
      runtime: lambda.Runtime.NODEJS_24_X,
      bundling: {
        bundler: 'esbuild', // bundler name
        bundlerConfig: 'build.mjs', // path to your bundler config
      },
    });
  }
}
```

### Entry file auto-detection

If you omit `entry`, the construct looks for a handler file next to the file that calls `new NodejsFunction(...)`, using the construct id as the filename stem:

```
stacks/
  appStack.ts         <-- calls new NodejsFunction(this, 'worker', ...)
  appStack.worker.ts  <-- auto-detected entry
```

Supported extensions (tried in order): `.ts`, `.js`, `.mjs`, `.mts`, `.cts`, `.cjs`.

Set `entry` explicitly to override this behaviour.

## Step 3: synthesise

```sh
cdk synth
# or
cdk deploy
```

CDK invokes your bundler during synthesis. Output is written to the CDK asset staging directory and uploaded to S3.

## Migrating from `aws_lambda_nodejs.NodejsFunction`

`NodejsFunction` from this package is a structural drop-in. The differences are:

- `bundling` is required and takes `BundlingOptions` (not `aws_lambda_nodejs.BundlingOptions`).
- There is no `externalModules` option. To prevent a package from being bundled, use your bundler's native `external` config option. To install a package into the Lambda output directory (e.g. for native binaries), use `nodeModules`.
- `depsLockFilePath` is detected automatically if not set (same heuristic as the CDK built-in).

All `lambda.FunctionOptions` props (`environment`, `timeout`, `memorySize`, `architecture`, `layers`, etc.) work unchanged.

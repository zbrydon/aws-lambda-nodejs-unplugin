# aws-lambda-nodejs-unplugin

A drop-in nodejs first replacement for [`aws_lambda_nodejs.NodejsFunction`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.NodejsFunction.html) that bundles your Lambda functions using any bundler supported by [unplugin](https://unplugin.unjs.io): **esbuild**, **Vite**, **Rollup**, **Rolldown**, **webpack**, **Rspack**, or **Farm**.

## Why

The built-in CDK `NodejsFunction` hardcodes esbuild. This package gives you:

- Full control over your bundler and its configuration
- The same CDK construct API you already know
- Support for any bundler that unplugin covers

## Installation

```sh
# npm
npm install aws-lambda-nodejs-unplugin

# pnpm
pnpm add aws-lambda-nodejs-unplugin

# yarn
yarn add aws-lambda-nodejs-unplugin
```

Peer dependencies (`aws-cdk-lib >= 2.130.0`, `constructs ^10.0.0`) must already be installed. Also install the bundler you intend to use as a dev dependency.

## Quick start

### 1. Write your bundler config

The config must export a default configuration object. The driver merges in the entry point and output directory at synthesis time; you do not need to set those in the config.

**`build.mjs`** (esbuild)

```js
export default {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
};
```

**`rolldown.config.mjs`** (rolldown)

```js
export default {
  output: {
    format: 'cjs',
    entryFileNames: 'index.js',
  },
  external: [/^node:/],
};
```

**`vite.lambda.config.mjs`** (Vite)

```js
export default {
  build: {
    target: 'node24',
    rolldownOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'index.js',
      },
    },
  },
};
```

### 2. Use `NodejsFunction` in your CDK stack

```ts
import { NodejsFunction } from 'aws-lambda-nodejs-unplugin';
import * as lambda from 'aws-cdk-lib/aws-lambda';

new NodejsFunction(this, 'my-function', {
  entry: 'src/my-function.ts',
  runtime: lambda.Runtime.NODEJS_24_X,
  bundling: {
    bundler: 'esbuild',
    bundlerConfig: 'build.mjs',
  },
});
```

## Documentation

- [Getting started](https://github.com/zbrydon/aws-lambda-nodejs-unplugin/blob/main/docs/getting-started.md)
- [Bundler configs](https://github.com/zbrydon/aws-lambda-nodejs-unplugin/blob/main/docs/bundlers.md)
- [API reference](https://github.com/zbrydon/aws-lambda-nodejs-unplugin/blob/main/docs/api-reference.md)
- [Advanced usage](https://github.com/zbrydon/aws-lambda-nodejs-unplugin/blob/main/docs/advanced.md)

## Security / trust model

Bundling runs **your code with the full privileges of the synth environment**
(typically CI, holding cloud credentials). Specifically, at synth time this
package:

- **Imports your bundler config file** (`bundlerConfig`) and executes it.
- **Runs any `commandHooks`** through the platform shell.
- **Runs a dependency install** (npm / pnpm / yarn / bun) when `nodeModules` is
  set, which by default executes the lifecycle scripts of every installed
  package.

Every one of these subprocesses (the bundler bridge, the package-manager
install, and command hooks) **inherits the full `process.env`** of the synth
process, so any secrets present in the environment are visible to that code.

Treat your bundler config, command hooks, and dependency tree as trusted code.
To reduce exposure:

- Set [`ignoreScripts: true`](https://github.com/zbrydon/aws-lambda-nodejs-unplugin/blob/main/docs/api-reference.md#ignorescripts)
  to disable package lifecycle scripts during the `nodeModules` install, the
  safer default for an untrusted or large transitive dependency tree.
- Set [`timeout`](https://github.com/zbrydon/aws-lambda-nodejs-unplugin/blob/main/docs/api-reference.md#timeout)
  to bound how long any single subprocess may run, so a hung or runaway process
  cannot block synth indefinitely.

## License

MIT

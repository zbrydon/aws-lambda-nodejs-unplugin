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
    rollupOptions: {
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
  runtime: lambda.Runtime.NODEJS_24_X,
  bundling: {
    bundler: 'esbuild',
    bundlerConfig: 'build.mjs',
  },
});
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Bundler configs](docs/bundlers.md)
- [API reference](docs/api-reference.md)
- [Advanced usage](docs/advanced.md)

## License

MIT

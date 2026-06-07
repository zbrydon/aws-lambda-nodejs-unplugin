---
'aws-lambda-nodejs-unplugin': patch
---

Initial release of `aws-lambda-nodejs-unplugin`.

`NodejsFunction` is a drop-in CDK construct replacement for `aws_lambda_nodejs.NodejsFunction` that bundles Lambda functions using any bundler supported by [unplugin](https://unplugin.unjs.io): esbuild, Vite, Rollup, Rolldown, webpack, Rspack, or Farm.

Features:

- `bundler` and `bundlerConfig` props select the bundler and point to a config file that exports a default configuration object; the construct merges in the CDK-controlled entry point and output directory at synthesis time
- `nodeModules` installs specified packages into the Lambda asset directory rather than embedding them in the bundle, with version resolution from your lock file
- `commandHooks` (`beforeBundling`, `afterBundling`, `beforeInstall`) for running shell commands at each stage of the pipeline
- Lock file auto-detection by walking up parent directories, with preference order: `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, `package-lock.json`
- `assetHash` for deterministic deployments
- All `lambda.FunctionOptions` props (`environment`, `timeout`, `memorySize`, `architecture`, `layers`, etc.) pass through unchanged
- Requires `aws-cdk-lib >= 2.130.0`, `constructs ^10.0.0`, and Node.js >= 24.14.0

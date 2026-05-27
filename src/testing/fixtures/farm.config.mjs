/**
 * Farm config for the Lambda function.
 *
 * Input and output.path are injected by the CDK bundling driver at synthesis
 * time. For local dev builds add them directly:
 *   compilation: { input: { index: 'src/handler.ts' }, output: { path: 'dist' }, ... },
 *
 * The external patterns here mark node: builtins as external; additional
 * nodeModules patterns are appended by the CDK bundling driver when nodeModules
 * is set on the construct.
 */
export default {
  compilation: {
    output: {
      entryFilename: '[entryName].js',
      format: 'cjs',
      targetEnv: 'node',
    },
    external: ['^node:.*'],
    sourcemap: false,
    minify: false,
    persistentCache: false,
  },
};

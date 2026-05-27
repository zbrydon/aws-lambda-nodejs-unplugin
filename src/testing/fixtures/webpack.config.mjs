import { createRequire } from 'module';

// Resolve the loader path at config-evaluation time so webpack can find it.
const require = createRequire(import.meta.url);
const esbuildLoader = require.resolve('./esbuild-loader.cjs');

/**
 * Webpack config for the Lambda function.
 *
 * Entry and output.path are injected by the CDK bundling driver at synthesis
 * time. For local dev builds add them directly:
 *   entry: './src/handler.ts',
 *   output: { path: path.resolve('dist'), ... },
 */
export default {
  module: {
    rules: [
      {
        test: /\.[mc]?ts$/,
        loader: esbuildLoader,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    filename: 'index.js',
    library: {
      type: 'commonjs2',
    },
  },
  target: 'node24',
  mode: 'production',
};

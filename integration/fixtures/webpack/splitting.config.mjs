import { createRequire } from 'module';

// Resolve the loader path at config-evaluation time so webpack can find it.
const require = createRequire(import.meta.url);
const esbuildLoader = require.resolve('../esbuild/loader.cjs');

/**
 * Webpack config that enables chunk splitting via optimization.splitChunks,
 * which the single-file Lambda asset model does not support. The webpack bridge
 * must reject this before building.
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
  optimization: {
    splitChunks: {
      chunks: 'all',
    },
  },
  target: 'node24',
  mode: 'production',
};

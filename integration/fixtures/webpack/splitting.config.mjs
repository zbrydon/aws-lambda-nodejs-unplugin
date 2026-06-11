import { createRequire } from 'module';

// Resolve the loader path at config-evaluation time so webpack can find it.
const require = createRequire(import.meta.url);
const esbuildLoader = require.resolve('../esbuild/loader.cjs');

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

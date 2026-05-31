import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const esbuildLoader = require.resolve('./esbuild-loader.cjs');

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
  externals: { zod: 'commonjs zod' },
};

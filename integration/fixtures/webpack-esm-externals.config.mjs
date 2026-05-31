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
  experiments: {
    outputModule: true,
  },
  output: {
    filename: 'index.js',
    module: true,
    library: {
      type: 'module',
    },
  },
  target: 'node24',
  mode: 'production',
  externalsType: 'module',
  externals: { zod: 'zod' },
};

import { createRequire } from 'module';
import { esmExternalsBase } from './esm-externals-base.mjs';

const require = createRequire(import.meta.url);
const esbuildLoader = require.resolve('./esbuild-loader.cjs');

export default {
  ...esmExternalsBase,
  module: {
    rules: [{ test: /\.[mc]?ts$/, loader: esbuildLoader }],
  },
  target: 'node24',
};

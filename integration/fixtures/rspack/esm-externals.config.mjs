import { esmExternalsBase } from '../esm-externals-base.mjs';

export default {
  ...esmExternalsBase,
  module: {
    rules: [{ test: /\.[mc]?ts$/, use: 'builtin:swc-loader' }],
  },
  target: 'node',
};

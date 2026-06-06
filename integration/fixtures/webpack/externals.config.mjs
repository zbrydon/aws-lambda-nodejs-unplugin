import baseConfig from './config.mjs';

export default {
  ...baseConfig,
  externals: { constructs: 'commonjs constructs' },
};

import baseConfig from './webpack.config.mjs';

export default {
  ...baseConfig,
  externals: { constructs: 'commonjs constructs' },
};

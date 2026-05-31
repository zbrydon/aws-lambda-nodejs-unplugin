import baseConfig from './webpack.config.mjs';

export default {
  ...baseConfig,
  externals: { zod: 'commonjs zod' },
};

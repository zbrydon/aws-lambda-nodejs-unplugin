import baseConfig from './rollup.config.mjs';

export default {
  ...baseConfig,
  external: [/^node:/, 'constructs'],
};

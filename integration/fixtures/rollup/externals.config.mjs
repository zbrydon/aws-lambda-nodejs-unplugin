import baseConfig from './config.mjs';

export default {
  ...baseConfig,
  external: [/^node:/, 'constructs'],
};

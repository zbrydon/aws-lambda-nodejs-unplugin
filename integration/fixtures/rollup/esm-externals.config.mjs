import baseConfig from './esm.config.mjs';

export default {
  ...baseConfig,
  output: {
    ...baseConfig.output,
    entryFileNames: 'index.mjs',
  },
  external: [/^node:/, 'constructs'],
};

import baseConfig from './esm.config.mjs';

/**
 * Rollup ESM output with `constructs` marked external, to exercise the ESM + externals
 * + `type: module` install path for a non-webpack/rspack bundler.
 */
export default {
  ...baseConfig,
  output: {
    ...baseConfig.output,
    entryFileNames: 'index.mjs',
  },
  external: [/^node:/, 'constructs'],
};

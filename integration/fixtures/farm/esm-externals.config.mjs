/**
 * Farm ESM output with `constructs` marked external, to exercise the
 * ESM + externals + `type: module` install path.
 */
export default {
  compilation: {
    output: {
      entryFilename: '[entryName].js',
      format: 'esm',
      targetEnv: 'node',
    },
    external: ['^node:.*', '^constructs(/.*)?$'],
    sourcemap: false,
    minify: false,
    persistentCache: false,
  },
};

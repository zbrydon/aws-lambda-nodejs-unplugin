/**
 * Farm config that forces a named chunk group via partialBundling, which the
 * single-file Lambda asset model does not support. The farm bridge must reject
 * this before building.
 */
export default {
  compilation: {
    output: {
      entryFilename: '[entryName].js',
      format: 'cjs',
      targetEnv: 'node',
    },
    external: ['^node:.*'],
    sourcemap: false,
    minify: false,
    persistentCache: false,
    partialBundling: {
      groups: [
        {
          name: 'vendor',
          test: ['node_modules/'],
        },
      ],
    },
  },
};

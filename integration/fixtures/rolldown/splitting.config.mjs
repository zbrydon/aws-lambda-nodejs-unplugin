/**
 * Rolldown config that forces chunk splitting via output.manualChunks, which the
 * single-file Lambda asset model does not support. The roll-factory bridge must
 * reject this before building.
 */
export default {
  output: {
    entryFileNames: 'index.js',
    format: 'cjs',
    manualChunks: {
      vendor: ['rollup'],
    },
  },
  external: [/^node:/],
};

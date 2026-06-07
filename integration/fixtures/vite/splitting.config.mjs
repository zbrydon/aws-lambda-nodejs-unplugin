/**
 * Vite config that forces chunk splitting via output.manualChunks, which the
 * single-file Lambda asset model does not support. The vite bridge must reject
 * this before building.
 */
export default {
  build: {
    emptyOutDir: false,
    target: 'node24',
    rolldownOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'index.js',
        manualChunks: {
          vendor: ['rollup'],
        },
      },
    },
  },
};

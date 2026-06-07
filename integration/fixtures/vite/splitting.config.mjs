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

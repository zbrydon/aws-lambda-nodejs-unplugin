export default {
  build: {
    emptyOutDir: false,
    target: 'node24',
    rolldownOptions: {
      external: ['constructs'],
      output: {
        format: 'es',
        entryFileNames: 'index.js',
      },
    },
  },
};

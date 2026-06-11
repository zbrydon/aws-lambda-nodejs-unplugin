export default {
  build: {
    emptyOutDir: false,
    target: 'node24',
    rolldownOptions: {
      output: {
        format: 'es',
        entryFileNames: 'index.js',
      },
    },
  },
};

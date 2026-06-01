export default {
  build: {
    emptyOutDir: false,
    target: 'node24',
    rolldownOptions: {
      external: ['zod'],
      output: {
        format: 'cjs',
        entryFileNames: 'index.js',
      },
    },
  },
};

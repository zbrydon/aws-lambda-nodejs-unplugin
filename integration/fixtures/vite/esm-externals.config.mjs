/**
 * Vite ESM output (Rolldown-backed) with `constructs` marked external, to
 * exercise the ESM + externals + `type: module` install path.
 */
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

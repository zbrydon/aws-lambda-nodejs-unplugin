/**
 * Rolldown ESM output with `constructs` marked external, to exercise the
 * ESM + externals + `type: module` install path.
 */
export default {
  output: {
    entryFileNames: 'index.js',
    format: 'es',
  },
  external: [/^node:/, 'constructs'],
};

export default {
  output: {
    entryFileNames: 'index.js',
    format: 'es',
  },
  external: [/^node:/, 'constructs'],
};

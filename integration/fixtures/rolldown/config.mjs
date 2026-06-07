export default {
  output: {
    entryFileNames: 'index.js',
    format: 'cjs',
  },
  external: [/^node:/],
};

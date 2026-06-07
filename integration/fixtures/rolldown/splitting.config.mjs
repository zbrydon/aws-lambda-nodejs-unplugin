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

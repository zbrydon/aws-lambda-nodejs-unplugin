export default {
  compilation: {
    output: {
      entryFilename: '[entryName].js',
      format: 'esm',
      targetEnv: 'node',
    },
    external: ['^node:.*', '^constructs(/.*)?$'],
    sourcemap: false,
    minify: false,
    persistentCache: false,
  },
};

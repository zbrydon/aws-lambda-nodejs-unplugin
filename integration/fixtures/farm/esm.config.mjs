export default {
  compilation: {
    output: {
      entryFilename: '[entryName].js',
      format: 'esm',
      targetEnv: 'node',
    },
    external: ['^node:.*'],
    sourcemap: false,
    minify: false,
    persistentCache: false,
  },
};

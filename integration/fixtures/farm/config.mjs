export default {
  compilation: {
    output: {
      entryFilename: '[entryName].js',
      format: 'cjs',
      targetEnv: 'node',
    },
    external: ['^node:.*'],
    sourcemap: false,
    minify: false,
    persistentCache: false,
  },
};

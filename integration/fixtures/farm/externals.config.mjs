export default {
  compilation: {
    output: {
      entryFilename: '[entryName].js',
      format: 'cjs',
      targetEnv: 'node',
    },
    external: ['^node:.*', '^constructs(/.*)?$'],
    sourcemap: false,
    minify: false,
    persistentCache: false,
  },
};

export default {
  compilation: {
    output: {
      entryFilename: '[entryName].js',
      format: 'cjs',
      targetEnv: 'node',
    },
    external: ['^node:.*', '^zod(/.*)?$'],
    sourcemap: false,
    minify: false,
    persistentCache: false,
  },
};

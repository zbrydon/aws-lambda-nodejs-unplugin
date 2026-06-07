export default {
  compilation: {
    output: {
      targetEnv: 'node',
      // format and entryFilename intentionally omitted
    },
    external: ['^node:.*'],
    sourcemap: false,
    minify: false,
    persistentCache: false,
  },
};

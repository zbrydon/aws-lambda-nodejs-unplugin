export default {
  module: {
    rules: [
      {
        test: /\.[mc]?ts$/,
        use: 'builtin:swc-loader',
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  experiments: {
    outputModule: true,
  },
  output: {
    filename: 'index.js',
    module: true,
    library: {
      type: 'module',
    },
  },
  target: 'node',
  mode: 'production',
  externalsType: 'module',
  externals: { zod: 'zod' },
};

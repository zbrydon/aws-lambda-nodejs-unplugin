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
  output: {
    filename: 'index.js',
    library: {
      type: 'commonjs2',
    },
  },
  target: 'node',
  mode: 'production',
  externals: { zod: 'commonjs zod' },
};

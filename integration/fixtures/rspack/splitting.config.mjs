/**
 * Rspack config that enables chunk splitting via optimization.splitChunks,
 * which the single-file Lambda asset model does not support. The rspack bridge
 * must reject this before building.
 */
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
  optimization: {
    splitChunks: {
      chunks: 'all',
    },
  },
  target: 'node',
  mode: 'production',
};

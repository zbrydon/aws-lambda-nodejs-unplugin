/**
 * Rspack config for the Lambda function.
 *
 * Entry and output.path are injected by the CDK bundling driver at synthesis
 * time. For local dev builds add them directly:
 *   entry: './src/handler.ts',
 *   output: { path: path.resolve('dist'), ... },
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
  target: 'node',
  mode: 'production',
};

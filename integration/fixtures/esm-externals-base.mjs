export const esmExternalsBase = {
  resolve: { extensions: ['.ts', '.js'] },
  experiments: { outputModule: true },
  output: {
    filename: 'index.js',
    module: true,
    library: { type: 'module' },
  },
  mode: 'production',
  externalsType: 'module',
  externals: { zod: 'zod' },
};

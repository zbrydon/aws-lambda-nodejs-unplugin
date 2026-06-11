import { defineConfig } from 'tsdown/config';

export default defineConfig([
  {
    failOnWarn: true,
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    inputOptions: {
      resolve: {
        alias: {
          '#src': './src',
        },
      },
    },
    checks: {
      legacyCjs: false,
    },
    exports: {
      devExports: 'aws-lambda-nodejs-unplugin/source',
    },
    publint: true,
    attw: true,
  },
  {
    failOnWarn: true,
    entry: [
      'src/bridges/esbuild.mts',
      'src/bridges/farm.mts',
      'src/bridges/rolldown.mts',
      'src/bridges/rollup.mts',
      'src/bridges/rspack.mts',
      'src/bridges/vite.mts',
      'src/bridges/webpack.mts',
    ],
    outDir: 'dist/bridges',
    format: ['esm'],
    dts: false,
  },
]);

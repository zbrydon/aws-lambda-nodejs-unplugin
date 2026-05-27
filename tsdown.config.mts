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
      devExports: '@seek/aws-lambda-nodejs-unplugin/source',
    },
    publint: true,
    attw: true,
  },
  {
    // Bridge runner scripts - ESM only, spawned by Node at bundle time.
    // All bare-specifier imports (peer deps and Node built-ins) must remain
    // external so they resolve from the user's node_modules at runtime.
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
    inputOptions: {
      // Anything that isn't a relative or absolute path is a node_modules
      // import — leave it unresolved for the user's runtime to supply.
      external: (id: string) => !id.startsWith('.') && !id.startsWith('/'),
    },
  },
]);

import { defaultExclude, defineConfig } from 'vitest/config';

/**
 * When integration tests run against source files, `import.meta.url` inside
 * `src/bundlers/*.ts` points to the source location, so `./bridges/foo.mjs`
 * would resolve to `src/bundlers/bridges/` which doesn't exist.
 *
 * The built `dist/index.mjs` is one level deep inside `dist/`, so
 * `./bridges/foo.mjs` correctly lands in `dist/bridges/` at runtime.
 *
 * This transform rewrites the path for source-mode test runs only, leaving
 * the production bundle path untouched.
 */
const fixBridgeSourcePaths = {
  name: 'fix-bridge-source-paths',
  transform: (code: string, id: string) =>
    /\/src\/bundlers\/[^/]+\.ts$/.test(id)
      ? {
          code: code.replace(/(new URL\([`"'])\.\/bridges\//g, '$1../../dist/bridges/'),
        }
      : undefined,
};

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['aws-lambda-nodejs-unplugin/source'],
    },
  },
  test: {
    coverage: {
      // The .mts bridge entrypoints (src/bridges/*.mts) are intentionally not
      // matched here: they execute only inside spawned `node` subprocesses at
      // bundle time, so V8 coverage cannot instrument them. They are exercised
      // end-to-end by the integration project instead.
      include: ['**/*.ts'],
      exclude: [
        ...defaultExclude,
        '**/node_modules*/**',
        '**/coverage/**',
        '**/dist/**',
        '**/lib/**',
        '**/lib-*/**',
        '**/tmp/**',
        '**/vitest.*.ts',
        '**/tsdown.config.*ts',
        'src/index.ts',
        'src/bundlers/types.ts',
        'src/testing',
        'integration',
        'knip.config.ts',
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          exclude: [...defaultExclude, 'integration/**'],
          env: {
            DEPLOYMENT: 'test',
          },
        },
      },
      {
        plugins: [fixBridgeSourcePaths],
        test: {
          name: 'integration',
          include: ['integration/**/*.test.ts'],
          env: {
            DEPLOYMENT: 'test',
          },
        },
      },
    ],
  },
});

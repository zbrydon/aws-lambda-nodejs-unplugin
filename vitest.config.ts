import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['@seek/aws-lambda-nodejs-unplugin/source'],
    },
  },
  test: {
    coverage: {
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
        // Barrel re-export — no executable logic to measure.
        'src/index.ts',
        // Interface-only file — compiles to no runtime statements.
        'src/bundlers/types.ts',
        'src/testing',
        'integration',
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

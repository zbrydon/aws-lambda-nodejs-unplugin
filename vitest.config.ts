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
        'src/index.ts',
        'src/bundlers/types.ts',
        'src/testing',
        'integration',
        'knip.config.ts',
        'scripts/profile.ts',
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

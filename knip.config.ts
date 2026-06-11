import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/bridges/*.mts'],
  project: ['src/**/*.{ts,mts}', 'integration/**/*.ts'],
  ignore: ['integration/fixtures/**', 'integration/**/*.worker.ts'],
};

export default config;

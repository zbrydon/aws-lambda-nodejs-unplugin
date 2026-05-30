import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    // Bridge runner scripts — separate build entry points spawned at bundle
    // time. They are not reachable from src/index.ts via TypeScript imports.
    'src/bridges/*.mts',
  ],
  project: ['src/**/*.{ts,mts}', 'integration/**/*.ts'],
  ignore: [
    // Lambda handler fixtures bundled at runtime by the integration tests;
    // they are not imported via TypeScript, so knip can't trace them.
    'src/testing/fixtures/**',
    // Handler fixture resolved by V8 callsite auto-detection at test runtime.
    'integration/**/*.worker.ts',
  ],
};

export default config;

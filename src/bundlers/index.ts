import { fileURLToPath } from 'node:url';
import { ValidationError } from '../errors.ts';
import type { SupportedBundler } from '../types.ts';
import type { BundlerAdapter } from './types.ts';

const makeAdapter = (name: SupportedBundler): BundlerAdapter => ({
  name,
  // Resolves to `dist/bridges/<name>.mjs` in the published package (import.meta.url
  // is `dist/index.mjs`). Note: under the `aws-lambda-nodejs-unplugin/source`
  // condition this would resolve to the nonexistent `src/bundlers/bridges/*.mjs`;
  // that condition is test-only and vitest rewrites the path to the built bridges.
  bridgeScriptPath: fileURLToPath(new URL(`./bridges/${name}.mjs`, import.meta.url)),
});

const REGISTRY: Record<SupportedBundler, BundlerAdapter> = {
  esbuild: makeAdapter('esbuild'),
  farm: makeAdapter('farm'),
  rolldown: makeAdapter('rolldown'),
  rollup: makeAdapter('rollup'),
  rspack: makeAdapter('rspack'),
  vite: makeAdapter('vite'),
  webpack: makeAdapter('webpack'),
};

export const getBundler = (name: SupportedBundler): BundlerAdapter => {
  // Runtime guard: the type system rejects unknown names, but JS callers (or a
  // value widened to string) would otherwise get a raw TypeError downstream when
  // `adapter.bridgeScriptPath` is read on undefined. Fail with a clear message.
  const adapter = REGISTRY[name];
  if (!adapter) {
    throw new ValidationError(
      `Unknown bundler '${name}'. Supported bundlers: ${Object.keys(REGISTRY).join(', ')}.`,
    );
  }
  return adapter;
};

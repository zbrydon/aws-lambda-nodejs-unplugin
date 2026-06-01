import { fileURLToPath } from 'node:url';
import type { SupportedBundler } from '../types.ts';
import type { BundlerAdapter } from './types.ts';

const makeAdapter = (name: SupportedBundler): BundlerAdapter => ({
  name,
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

export const getBundler = (name: SupportedBundler): BundlerAdapter => REGISTRY[name];

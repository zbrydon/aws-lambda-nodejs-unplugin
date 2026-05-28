import type { SupportedBundler } from '../types.ts';
import { esbuildAdapter } from './esbuild.ts';
import { farmAdapter } from './farm.ts';
import { rolldownAdapter } from './rolldown.ts';
import { rollupAdapter } from './rollup.ts';
import { rspackAdapter } from './rspack.ts';
import type { BundlerAdapter } from './types.ts';
import { viteAdapter } from './vite.ts';
import { webpackAdapter } from './webpack.ts';

const REGISTRY: Record<SupportedBundler, BundlerAdapter> = {
  esbuild: esbuildAdapter,
  farm: farmAdapter,
  rolldown: rolldownAdapter,
  rollup: rollupAdapter,
  rspack: rspackAdapter,
  vite: viteAdapter,
  webpack: webpackAdapter,
};

export const getBundler = (name: SupportedBundler): BundlerAdapter => REGISTRY[name];

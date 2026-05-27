import { fileURLToPath } from 'url';
import type { BundlerAdapter } from './types.ts';

export const esbuildAdapter: BundlerAdapter = {
  name: 'esbuild',
  bridgeScriptPath: fileURLToPath(new URL('../../dist/bridges/esbuild.mjs', import.meta.url)),
};

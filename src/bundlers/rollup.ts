import { fileURLToPath } from 'url';
import type { BundlerAdapter } from './types.ts';

export const rollupAdapter: BundlerAdapter = {
  name: 'rollup',
  bridgeScriptPath: fileURLToPath(new URL('./bridges/rollup.mjs', import.meta.url)),
};

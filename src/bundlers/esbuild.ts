import { fileURLToPath } from 'url';
import type { BundlerAdapter } from './types.ts';

export const esbuildAdapter: BundlerAdapter = {
  name: 'esbuild',
  bridgeScriptPath: fileURLToPath(new URL('./bridges/esbuild.mjs', import.meta.url)),
};

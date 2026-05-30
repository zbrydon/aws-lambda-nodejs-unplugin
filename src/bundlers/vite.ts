import { fileURLToPath } from 'url';
import type { BundlerAdapter } from './types.ts';

export const viteAdapter: BundlerAdapter = {
  name: 'vite',
  bridgeScriptPath: fileURLToPath(new URL('./bridges/vite.mjs', import.meta.url)),
};

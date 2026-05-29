import { fileURLToPath } from 'url';
import type { BundlerAdapter } from './types.ts';

export const farmAdapter: BundlerAdapter = {
  name: 'farm',
  bridgeScriptPath: fileURLToPath(new URL('./bridges/farm.mjs', import.meta.url)),
};

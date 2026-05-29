import { fileURLToPath } from 'url';
import type { BundlerAdapter } from './types.ts';

export const rolldownAdapter: BundlerAdapter = {
  name: 'rolldown',
  bridgeScriptPath: fileURLToPath(new URL('./bridges/rolldown.mjs', import.meta.url)),
};

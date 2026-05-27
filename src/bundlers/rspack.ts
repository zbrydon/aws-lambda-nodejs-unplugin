import { fileURLToPath } from 'url';
import type { BundlerAdapter } from './types.ts';

export const rspackAdapter: BundlerAdapter = {
  name: 'rspack',
  bridgeScriptPath: fileURLToPath(new URL('../../dist/bridges/rspack.mjs', import.meta.url)),
};

import { fileURLToPath } from 'url';
import type { BundlerAdapter } from './types.ts';

export const webpackAdapter: BundlerAdapter = {
  name: 'webpack',
  bridgeScriptPath: fileURLToPath(new URL('../../dist/bridges/webpack.mjs', import.meta.url)),
};

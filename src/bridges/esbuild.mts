import { build } from 'esbuild';
import type { Plugin } from 'esbuild';
import * as path from 'node:path';
import { getArgs } from './get-args.ts';
import { writeBundleMeta } from './write-meta.ts';

const { configPath, entry, outputDir, nodeModules } = getArgs();

const { default: userConfig } = await import(configPath);

if (!userConfig || typeof userConfig !== 'object') {
  throw new Error(`Config file must export a default config object: ${configPath}`);
}

const externalPlugin: Plugin = {
  name: 'lambda-externals',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (nodeModules.some((m) => args.path === m || args.path.startsWith(`${m}/`))) {
        return { path: args.path, external: true };
      }
      return undefined;
    });
  },
};

const { outdir: _outdir, outfile: _of, entryPoints: _ep, ...restConfig } = userConfig;
await build({
  ...restConfig,
  entryPoints: [entry],
  outfile: path.join(outputDir, 'index.js'),
  plugins: [...(restConfig.plugins ?? []), externalPlugin],
});
writeBundleMeta(outputDir, restConfig.format);

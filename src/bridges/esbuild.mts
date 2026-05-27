import { build } from 'esbuild';
import type { Plugin } from 'esbuild';
import * as path from 'path';
import { getArgs } from './get-args.ts';

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

await build({
  ...userConfig,
  entryPoints: [entry],
  outfile: path.join(outputDir, 'index.js'),
  plugins: [...(userConfig.plugins ?? []), externalPlugin],
});

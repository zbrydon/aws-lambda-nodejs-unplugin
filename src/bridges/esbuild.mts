import { build } from 'esbuild';
import * as path from 'node:path';
import { getArgs } from './get-args.ts';
import { writeBundleMeta } from './write-meta.ts';

const { configPath, entry, outputDir } = getArgs();

const { default: userConfig } = await import(configPath);

if (!userConfig || typeof userConfig !== 'object') {
  throw new Error(`Config file must export a default config object: ${configPath}`);
}

const { outdir: _outdir, outfile: _of, entryPoints: _ep, ...restConfig } = userConfig;
await build({
  ...restConfig,
  entryPoints: [entry],
  outfile: path.join(outputDir, 'index.js'),
});
writeBundleMeta(outputDir, restConfig.format);

import { build, type BuildOptions } from 'esbuild';
import * as path from 'node:path';
import { asString } from './config.ts';
import { assertEntryFileEmitted, rejectSplittingOption } from './guard.ts';
import { loadBridgeContext } from './load-context.ts';
import { entryFileName, writeBundleMeta } from './write-meta.ts';

const { entry, outputDir, userConfig } = await loadBridgeContext();

const { outdir: _outdir, outfile: _of, entryPoints: _ep, ...restConfig } = userConfig;

rejectSplittingOption(restConfig.splitting, 'esbuild "splitting"');

const format = asString(restConfig.format);

await build({
  ...restConfig,
  entryPoints: [entry],
  outfile: path.join(outputDir, entryFileName(format)),
} satisfies BuildOptions);
assertEntryFileEmitted(outputDir, format);
writeBundleMeta(outputDir, format);

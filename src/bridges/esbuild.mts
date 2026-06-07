import { build, type BuildOptions } from 'esbuild';
import * as path from 'node:path';
import { asString } from './config.ts';
import { assertSingleEntryFile, rejectSplittingOption } from './guard.ts';
import { loadBridgeContext } from './load-context.ts';
import { entryFileName, writeBundleMeta } from './write-meta.ts';

const { entry, outputDir, userConfig } = await loadBridgeContext();

const { outdir: _outdir, outfile: _of, entryPoints: _ep, ...restConfig } = userConfig;

// The Lambda handler is emitted as a single `index.js` via esbuild's `outfile`,
// which is incompatible with code splitting. Fail early with a clear message
// rather than surfacing esbuild's lower-level "Cannot use outfile with splitting".
rejectSplittingOption(restConfig.splitting, 'esbuild "splitting"');

const format = asString(restConfig.format);
// userConfig is an arbitrary module validated only as an object, so assert the
// esbuild option shape when merging the CDK-controlled entry/outfile into it.
await build({
  ...restConfig,
  entryPoints: [entry],
  outfile: path.join(outputDir, entryFileName(format)),
} satisfies BuildOptions);
assertSingleEntryFile(outputDir, format);
writeBundleMeta(outputDir, format);

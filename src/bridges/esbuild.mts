import { build } from 'esbuild';
import * as path from 'node:path';
import { assertSingleEntryFile } from './guard.ts';
import { loadBridgeContext } from './load-context.ts';
import { entryFileName, writeBundleMeta } from './write-meta.ts';

const { entry, outputDir, userConfig } = await loadBridgeContext();

const { outdir: _outdir, outfile: _of, entryPoints: _ep, ...restConfig } = userConfig;

// The Lambda handler is emitted as a single `index.js` via esbuild's `outfile`,
// which is incompatible with code splitting. Fail early with a clear message
// rather than surfacing esbuild's lower-level "Cannot use outfile with splitting".
if (restConfig.splitting) {
  throw new Error(
    'esbuild "splitting" is not supported: the Lambda handler is emitted as a single index.js file.',
  );
}

const format: string | undefined = restConfig.format;
await build({
  ...restConfig,
  entryPoints: [entry],
  outfile: path.join(outputDir, entryFileName(format)),
});
assertSingleEntryFile(outputDir, format);
writeBundleMeta(outputDir, format);

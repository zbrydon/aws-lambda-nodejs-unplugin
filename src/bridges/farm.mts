import { build } from '@farmfe/core';

import { getArgs } from './get-args.ts';
import { assertSingleEntryFile, rejectSplittingOption } from './guard.ts';
import { isEsmFormat, writeBundleMeta } from './write-meta.ts';

const { configPath, entry, outputDir } = getArgs();

const { default: userConfig } = await import(configPath);

if (!userConfig || typeof userConfig !== 'object') {
  throw new Error(`Config file must export a default config object: ${configPath}`);
}

// Farm emits ESM (`export { handler }`) when output.format is omitted - verified
// empirically with @farmfe/core under both the default and `targetEnv: 'node'`.
// Default to 'esm' (matching the vite/rollup/rolldown bridges) so the handler is
// written as index.mjs with `type: module`; defaulting to CJS would write an
// `export`-bearing file to index.js and the Lambda would fail to load.
const format: string = userConfig.compilation?.output?.format ?? 'esm';

// Reject the explicit chunk-creating knobs at config time. Farm splits output
// via `compilation.partialBundling`; `groups` and `enforceResources` are the
// fields that force named chunks into being, mirroring how the other bridges
// reject manualChunks / splitChunks. The numeric tuning fields tune the default
// partial-bundling algorithm rather than forcing a split, so they are left to
// the post-build assertion below.
const partialBundling = userConfig.compilation?.partialBundling;
rejectSplittingOption(partialBundling?.groups, 'compilation.partialBundling.groups');
rejectSplittingOption(
  partialBundling?.enforceResources,
  'compilation.partialBundling.enforceResources',
);

await build({
  ...userConfig,
  compilation: {
    ...userConfig.compilation,
    input: { index: entry },
    output: {
      ...userConfig.compilation?.output,
      path: outputDir,
      // Enforce [entryName].(m)js so the output is always index.js (CJS) or
      // index.mjs (ESM) regardless of the user's entryFilename.
      entryFilename: isEsmFormat(format) ? '[entryName].mjs' : '[entryName].js',
    },
  },
});
// Backstop for any split the config-level guard above cannot see: numeric
// partialBundling thresholds (targetMaxSize, etc.) and dynamic import()
// splitting are only observable after the build, so assert a single entry file.
assertSingleEntryFile(outputDir, format);
writeBundleMeta(outputDir, format);

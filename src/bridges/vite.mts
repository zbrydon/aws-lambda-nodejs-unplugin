import { build } from 'vite';
import type { InlineConfig } from 'vite';

import { asRecord, asString } from './config.ts';
import { assertSingleEntryFile, rejectRollupStyleSplitting } from './guard.ts';
import { loadBridgeContext } from './load-context.ts';
import { entryFileName, writeBundleMeta } from './write-meta.ts';

const { entry, outputDir, userConfig } = await loadBridgeContext();

const buildConfig = asRecord(userConfig.build);

const rollOptions = asRecord(buildConfig?.rolldownOptions) ?? asRecord(buildConfig?.rollupOptions);
const rawOutput = rollOptions?.output;
const baseOutput = asRecord(Array.isArray(rawOutput) ? rawOutput[0] : rawOutput);

const format = asString(baseOutput?.format) ?? 'es';

rejectRollupStyleSplitting(rawOutput, baseOutput, 'Vite');

const { rollupOptions: _ruo, rolldownOptions: _rdo, ...restBuild } = buildConfig ?? {};

const mergedRollOptions = {
  ...rollOptions,
  output: {
    ...baseOutput,
    entryFileNames: entryFileName(format),
  },
};

await build({
  ...userConfig,
  build: {
    ...restBuild,
    ssr: entry,
    outDir: outputDir,
    emptyOutDir: false,

    rollupOptions: mergedRollOptions,
    rolldownOptions: mergedRollOptions,
  },
} satisfies InlineConfig);

assertSingleEntryFile(outputDir, format);
writeBundleMeta(outputDir, format);

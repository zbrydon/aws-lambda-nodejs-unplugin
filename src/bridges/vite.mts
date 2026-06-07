import { build } from 'vite';
import type { InlineConfig } from 'vite';

import { asRecord, asString } from './config.ts';
import { assertSingleEntryFile, rejectRollupStyleSplitting } from './guard.ts';
import { loadBridgeContext } from './load-context.ts';
import { entryFileName, writeBundleMeta } from './write-meta.ts';

const { entry, outputDir, userConfig } = await loadBridgeContext();

const buildConfig = asRecord(userConfig.build);
// A Vite build can be backed by either Rollup (build.rollupOptions) or
// Rolldown (build.rolldownOptions) depending on the installed Vite flavour.
// Read whichever the user supplied so their output config is preserved.
const rollOptions = asRecord(buildConfig?.rolldownOptions) ?? asRecord(buildConfig?.rollupOptions);
const rawOutput = rollOptions?.output;
const baseOutput = asRecord(Array.isArray(rawOutput) ? rawOutput[0] : rawOutput);
// Vite 6 SSR defaults to 'es' when no format is specified.
const format = asString(baseOutput?.format) ?? 'es';

// Reject multi-output configs and the splitting options that would emit sibling
// chunks the asset never ships. Vite is Rollup/Rolldown-backed, so this reuses
// the same guard as the rollup/rolldown bridges.
rejectRollupStyleSplitting(rawOutput, baseOutput, 'Vite');

// Strip both keys from the user build config so the canonical merged options
// below are the only ones present.
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
    // Emit under both keys so the index.js / format override applies whether the
    // resolved Vite is Rollup-based (rollupOptions) or Rolldown-based
    // (rolldownOptions). Each flavour reads its own key and ignores the other.
    rollupOptions: mergedRollOptions,
    rolldownOptions: mergedRollOptions,
  },
} satisfies InlineConfig);
// Backstop for dynamic import() splitting, undetectable from config.
assertSingleEntryFile(outputDir, format);
writeBundleMeta(outputDir, format);

import { build } from 'vite';

import { getArgs } from './get-args.ts';
import { assertSingleEntryFile, rejectSplittingOption } from './guard.ts';
import { entryFileName, writeBundleMeta } from './write-meta.ts';

const { configPath, entry, outputDir } = getArgs();

const { default: userConfig } = await import(configPath);

if (!userConfig || typeof userConfig !== 'object') {
  throw new Error(`Config file must export a default config object: ${configPath}`);
}

// A Vite build can be backed by either Rollup (build.rollupOptions) or
// Rolldown (build.rolldownOptions) depending on the installed Vite flavour.
// Read whichever the user supplied so their output config is preserved.
const rollOptions = userConfig.build?.rolldownOptions ?? userConfig.build?.rollupOptions;
const rawOutput = rollOptions?.output;
const baseOutput = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput;
// Vite 6 SSR defaults to 'es' when no format is specified.
const format: string = baseOutput?.format ?? 'es';

// Reject splitting options that would emit sibling chunks the asset never ships.
if (Array.isArray(rawOutput) && rawOutput.length > 1) {
  throw new Error(
    'Multiple Vite build outputs are not supported: the Lambda handler is a single file. ' +
      'Provide a single `build.rollupOptions.output` (or `rolldownOptions.output`).',
  );
}
rejectSplittingOption(baseOutput?.manualChunks, 'Vite output.manualChunks');
rejectSplittingOption(baseOutput?.preserveModules, 'Vite output.preserveModules');

// Strip both keys from the user build config so the canonical merged options
// below are the only ones present.
const { rollupOptions: _ruo, rolldownOptions: _rdo, ...restBuild } = userConfig.build ?? {};

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
});
// Backstop for dynamic import() splitting, undetectable from config.
assertSingleEntryFile(outputDir, format);
writeBundleMeta(outputDir, format);

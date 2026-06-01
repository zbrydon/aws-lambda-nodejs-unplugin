import { build } from 'vite';

import { getArgs } from './get-args.ts';
import { writeBundleMeta } from './write-meta.ts';

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

// Strip both keys from the user build config so the canonical merged options
// below are the only ones present.
const { rollupOptions: _ruo, rolldownOptions: _rdo, ...restBuild } = userConfig.build ?? {};

const mergedRollOptions = {
  ...rollOptions,
  output: {
    ...baseOutput,
    entryFileNames: 'index.js',
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
// Vite 6 SSR defaults to 'es' when no format is specified.
writeBundleMeta(outputDir, baseOutput?.format ?? 'es');

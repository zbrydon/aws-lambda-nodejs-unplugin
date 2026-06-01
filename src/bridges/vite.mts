import { build } from 'vite';

import { getArgs } from './get-args.ts';
import { writeBundleMeta } from './write-meta.ts';

const { configPath, entry, outputDir } = getArgs();

const { default: userConfig } = await import(configPath);

if (!userConfig || typeof userConfig !== 'object') {
  throw new Error(`Config file must export a default config object: ${configPath}`);
}

// Support rolldownOptions (Vite 6+) and the deprecated rollupOptions alias.
const rollOptions = userConfig.build?.rolldownOptions ?? userConfig.build?.rollupOptions;
const rawOutput = rollOptions?.output;
const baseOutput = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput;

// Destructure both option keys out of the user build config so we can supply
// a single canonical rolldownOptions without the two aliases conflicting.
const { rollupOptions: _ruo, rolldownOptions: _rdo, ...restBuild } = userConfig.build ?? {};

await build({
  ...userConfig,
  build: {
    ...restBuild,
    ssr: entry,
    outDir: outputDir,
    emptyOutDir: false,
    rolldownOptions: {
      ...rollOptions,
      output: {
        ...baseOutput,
        entryFileNames: 'index.js',
      },
    },
  },
});
// Vite 6 SSR defaults to 'es' when no format is specified.
writeBundleMeta(outputDir, baseOutput?.format ?? 'es');

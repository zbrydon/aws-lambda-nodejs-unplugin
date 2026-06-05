import { build } from '@farmfe/core';

import { getArgs } from './get-args.ts';
import { isEsmFormat, writeBundleMeta } from './write-meta.ts';

const { configPath, entry, outputDir } = getArgs();

const { default: userConfig } = await import(configPath);

if (!userConfig || typeof userConfig !== 'object') {
  throw new Error(`Config file must export a default config object: ${configPath}`);
}

const format: string | undefined = userConfig.compilation?.output?.format;

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
writeBundleMeta(outputDir, format);

import { build } from '@farmfe/core';

import { getArgs } from './get-args.ts';
import { writeBundleMeta } from './write-meta.ts';

const { configPath, entry, outputDir } = getArgs();

const { default: userConfig } = await import(configPath);

if (!userConfig || typeof userConfig !== 'object') {
  throw new Error(`Config file must export a default config object: ${configPath}`);
}

await build({
  ...userConfig,
  compilation: {
    ...userConfig.compilation,
    input: { index: entry },
    output: {
      ...userConfig.compilation?.output,
      path: outputDir,
      // Enforce [entryName].js so the output is always index.js regardless of user config.
      entryFilename: '[entryName].js',
    },
  },
});
writeBundleMeta(outputDir, userConfig.compilation?.output?.format);

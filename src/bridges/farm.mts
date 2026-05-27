import { build } from '@farmfe/core';

import { getArgs } from './get-args.ts';

const { configPath, entry, outputDir, nodeModules } = getArgs();

const { default: userConfig } = await import(configPath);

if (!userConfig || typeof userConfig !== 'object') {
  throw new Error(`Config file must export a default config object: ${configPath}`);
}

const nodeModulePatterns = nodeModules.map((m) => {
  const escaped = m.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  return `^${escaped}(/.*)?$`;
});

await build({
  ...userConfig,
  compilation: {
    ...userConfig.compilation,
    input: { index: entry },
    output: {
      ...userConfig.compilation?.output,
      path: outputDir,
    },
    external: [...(userConfig.compilation?.external ?? []), ...nodeModulePatterns],
  },
});

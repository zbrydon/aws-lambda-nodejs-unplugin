import { build } from '@farmfe/core';

import { asRecord, asString } from './config.ts';
import { assertEntryFileEmitted, rejectSplittingOption } from './guard.ts';
import { loadBridgeContext } from './load-context.ts';
import { isEsmFormat, writeBundleMeta } from './write-meta.ts';

const { entry, outputDir, userConfig } = await loadBridgeContext();

const compilation = asRecord(userConfig.compilation);
const output = asRecord(compilation?.output);

const format = asString(output?.format) ?? 'esm';

const partialBundling = asRecord(compilation?.partialBundling);
rejectSplittingOption(partialBundling?.groups, 'compilation.partialBundling.groups');
rejectSplittingOption(
  partialBundling?.enforceResources,
  'compilation.partialBundling.enforceResources',
);

await build({
  ...userConfig,
  compilation: {
    ...compilation,
    input: { index: entry },
    output: {
      ...output,
      path: outputDir,

      entryFilename: isEsmFormat(format) ? '[entryName].mjs' : '[entryName].js',
    },
  },
} satisfies Parameters<typeof build>[0]);

assertEntryFileEmitted(outputDir, format);
writeBundleMeta(outputDir, format);

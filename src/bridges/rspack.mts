import { rspack } from '@rspack/core';
import type { Configuration } from '@rspack/core';
import { assertSingleEntryFile, rejectSplittingOption } from './guard.ts';
import { loadBridgeContext } from './load-context.ts';
import { entryFileName, writeBundleMeta } from './write-meta.ts';

const { entry, outputDir, userConfig } = await loadBridgeContext();

// rspack only emits ESM when output.module is true (it also requires
// experiments.outputModule), so output.module is the authoritative signal.
const format = userConfig.output?.module === true ? 'esm' : undefined;

// Reject chunk-splitting options that would emit sibling chunks the asset never ships.
rejectSplittingOption(userConfig.optimization?.splitChunks, 'rspack optimization.splitChunks');
rejectSplittingOption(userConfig.optimization?.runtimeChunk, 'rspack optimization.runtimeChunk');

const finalConfig: Configuration = {
  ...userConfig,
  entry,
  output: {
    ...userConfig.output,
    path: outputDir,
    filename: entryFileName(format),
  },
  // ESM output requires experiments.outputModule; inject it so a config that
  // sets only output.module does not error or emit a CJS file that diverges
  // from the recorded ESM format.
  ...(format === 'esm' ? { experiments: { ...userConfig.experiments, outputModule: true } } : {}),
};

const compiler = rspack(finalConfig);

await new Promise<void>((resolve, reject) => {
  compiler.run((err, stats) => {
    if (err) {
      compiler.close(() => reject(err));
      return;
    }
    if (stats?.hasErrors()) {
      compiler.close(() => reject(new Error(stats.toString({ errors: true }))));
      return;
    }
    compiler.close(() => resolve());
  });
});
// Backstop for dynamic import() splitting, undetectable from config.
assertSingleEntryFile(outputDir, format);
writeBundleMeta(outputDir, format);

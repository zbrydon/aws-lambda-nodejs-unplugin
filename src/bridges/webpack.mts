import webpack from 'webpack';
import type { Configuration } from 'webpack';
import { asRecord } from './config.ts';
import { assertSingleEntryFile, rejectSplittingOption } from './guard.ts';
import { loadBridgeContext } from './load-context.ts';
import { entryFileName, writeBundleMeta } from './write-meta.ts';

const { entry, outputDir, userConfig } = await loadBridgeContext();

const output = asRecord(userConfig.output);
const experiments = asRecord(userConfig.experiments);
const optimization = asRecord(userConfig.optimization);

// webpack emits ESM when output.module is true (which also requires
// experiments.outputModule). Accept either signal so a config that enables ESM
// via experiments.outputModule alone is not mislabelled and shipped as CJS.
const format = output?.module === true || experiments?.outputModule === true ? 'esm' : undefined;

// Reject chunk-splitting options that would emit sibling chunks the asset never ships.
rejectSplittingOption(optimization?.splitChunks, 'webpack optimization.splitChunks');
rejectSplittingOption(optimization?.runtimeChunk, 'webpack optimization.runtimeChunk');

const finalConfig = {
  ...userConfig,
  entry,
  output: {
    ...output,
    path: outputDir,
    filename: entryFileName(format),
  },
  // ESM output requires experiments.outputModule; inject it so a config that
  // sets only output.module does not error or emit a CJS file that diverges
  // from the recorded ESM format.
  ...(format === 'esm' ? { experiments: { ...experiments, outputModule: true } } : {}),
} satisfies Configuration;

const compiler = webpack(finalConfig);

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

import webpack from 'webpack';
import type { Configuration } from 'webpack';
import { getArgs } from './get-args.ts';
import { assertSingleEntryFile, rejectSplittingOption } from './guard.ts';
import { entryFileName, writeBundleMeta } from './write-meta.ts';

const { configPath, entry, outputDir } = getArgs();

const { default: userConfig } = await import(configPath);

if (!userConfig || typeof userConfig !== 'object') {
  throw new Error(`Config file must export a default config object: ${configPath}`);
}

// webpack only emits ESM when output.module is true (it also requires
// experiments.outputModule), so output.module is the authoritative signal.
const format = userConfig.output?.module === true ? 'esm' : undefined;

// Reject chunk-splitting options that would emit sibling chunks the asset never ships.
rejectSplittingOption(userConfig.optimization?.splitChunks, 'webpack optimization.splitChunks');
rejectSplittingOption(userConfig.optimization?.runtimeChunk, 'webpack optimization.runtimeChunk');

const finalConfig: Configuration = {
  ...userConfig,
  entry,
  output: {
    ...userConfig.output,
    path: outputDir,
    filename: entryFileName(format),
  },
};

await new Promise<void>((resolve, reject) => {
  webpack(finalConfig, (err, stats) => {
    if (err) {
      reject(err);
      return;
    }
    if (stats?.hasErrors()) {
      reject(new Error(stats.toString({ errors: true })));
      return;
    }
    resolve();
  });
});
// Backstop for dynamic import() splitting, undetectable from config.
assertSingleEntryFile(outputDir, format);
writeBundleMeta(outputDir, format);

import webpack from 'webpack';
import type { Configuration } from 'webpack';
import { getArgs } from './get-args.ts';
import { writeBundleMeta } from './write-meta.ts';

const { configPath, entry, outputDir } = getArgs();

const { default: userConfig } = await import(configPath);

if (!userConfig || typeof userConfig !== 'object') {
  throw new Error(`Config file must export a default config object: ${configPath}`);
}

const finalConfig: Configuration = {
  ...userConfig,
  entry,
  output: {
    ...userConfig.output,
    path: outputDir,
    filename: 'index.js',
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
// webpack only emits ESM when output.module is true (it also requires
// experiments.outputModule), so output.module is the authoritative signal.
writeBundleMeta(outputDir, userConfig.output?.module === true ? 'esm' : undefined);

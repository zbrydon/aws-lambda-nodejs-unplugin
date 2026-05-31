import webpack from 'webpack';
import type { Configuration } from 'webpack';
import { getArgs } from './get-args.ts';
import { writeBundleMeta } from './write-meta.ts';

const { configPath, entry, outputDir, nodeModules } = getArgs();

const { default: userConfig } = await import(configPath);

if (!userConfig || typeof userConfig !== 'object') {
  throw new Error(`Config file must export a default config object: ${configPath}`);
}

const plugins = [...(userConfig.plugins ?? [])];
if (nodeModules.length > 0) {
  const externalsType = userConfig.output?.module === true ? 'module' : 'commonjs';
  plugins.push(
    new webpack.ExternalsPlugin(externalsType, ({ request }, callback) => {
      if (nodeModules.some((m) => request === m || request?.startsWith(`${m}/`))) {
        return callback(null, request);
      }
      callback();
    }),
  );
}

const finalConfig: Configuration = {
  ...userConfig,
  entry,
  output: {
    ...userConfig.output,
    path: outputDir,
    filename: 'index.js',
  },
  plugins,
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
writeBundleMeta(outputDir, userConfig.output?.module === true ? 'esm' : undefined);

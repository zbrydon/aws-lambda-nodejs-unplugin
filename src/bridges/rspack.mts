import { rspack } from '@rspack/core';
import type { Configuration } from '@rspack/core';
import { getArgs } from './get-args.ts';

const { configPath, entry, outputDir, nodeModules } = getArgs();

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

const compiler = rspack(finalConfig);

if (nodeModules.length > 0) {
  const { ExternalsPlugin } = compiler.rspack;
  new ExternalsPlugin('commonjs', ({ request }, callback) => {
    if (nodeModules.some((m) => request === m || request?.startsWith(`${m}/`))) {
      callback(undefined, request);
      return;
    }
    callback();
  }).apply(compiler);
}

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

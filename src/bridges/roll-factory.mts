import type { InputOptions, OutputOptions } from 'rollup';
import { getArgs } from './get-args.ts';
import { writeBundleMeta } from './write-meta.ts';

type RollBundler = (options: InputOptions) => Promise<{
  write(options: OutputOptions): Promise<unknown>;
  close(): Promise<void>;
}>;

export const runRollBridge = async (bundler: RollBundler): Promise<void> => {
  const { configPath, entry, outputDir } = getArgs();

  const { default: userConfig } = await import(configPath);

  if (!userConfig || typeof userConfig !== 'object') {
    throw new Error(`Config file must export a default config object: ${configPath}`);
  }

  const inputOptions: InputOptions = {
    ...userConfig,
    input: entry,
  };

  const rawOutput = userConfig.output;
  const baseOutput = Array.isArray(rawOutput) ? rawOutput[0] : (rawOutput ?? {});

  const outputOptions: OutputOptions = {
    ...baseOutput,
    dir: outputDir,
    entryFileNames: 'index.js',
  };

  const bundle = await bundler(inputOptions);
  await bundle.write(outputOptions);
  await bundle.close();
  writeBundleMeta(outputDir, outputOptions.format);
};

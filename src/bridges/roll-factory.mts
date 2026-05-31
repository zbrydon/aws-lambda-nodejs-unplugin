import { getArgs } from './get-args.ts';
import { writeBundleMeta } from './write-meta.ts';

export type RollBundler<TInput, TOutput> = (options: TInput) => Promise<{
  write(options: TOutput): Promise<unknown>;
  close(): Promise<void>;
}>;

export const runRollBridge = async <TInput, TOutput>(
  bundler: RollBundler<TInput, TOutput>,
): Promise<void> => {
  const { configPath, entry, outputDir } = getArgs();

  const { default: userConfig } = await import(configPath);

  if (!userConfig || typeof userConfig !== 'object') {
    throw new Error(`Config file must export a default config object: ${configPath}`);
  }

  const inputOptions = {
    ...userConfig,
    input: entry,
  };

  const rawOutput = userConfig.output;
  const baseRaw = Array.isArray(rawOutput) ? rawOutput[0] : (rawOutput ?? {});
  const extraRaw = Array.isArray(rawOutput) ? rawOutput.slice(1) : [];

  const makeOutputOptions = (o: object) =>
    ({
      ...o,
      dir: outputDir,
      entryFileNames: 'index.js',
    }) as TOutput;

  const baseOutputOptions = makeOutputOptions(baseRaw);

  const bundle = await bundler(inputOptions);
  await bundle.write(baseOutputOptions);
  for (const o of extraRaw) {
    await bundle.write(makeOutputOptions(o));
  }
  await bundle.close();
  writeBundleMeta(outputDir, baseRaw.format);
};

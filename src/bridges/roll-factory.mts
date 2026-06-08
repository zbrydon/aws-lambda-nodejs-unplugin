import { asRecord, asString } from './config.ts';
import { assertEntryFileEmitted, rejectRollupStyleSplitting } from './guard.ts';
import { loadBridgeContext } from './load-context.ts';
import { entryFileName, writeBundleMeta } from './write-meta.ts';

export type RollBundler<TInput, TOutput> = (options: TInput) => Promise<{
  write(options: TOutput): Promise<unknown>;
  close(): Promise<void>;
}>;

export const runRollBridge = async <TInput, TOutput>(
  bundler: RollBundler<TInput, TOutput>,
): Promise<void> => {
  const { entry, outputDir, userConfig } = await loadBridgeContext();

  const inputOptions = {
    ...userConfig,
    input: entry,
  } as TInput;

  const rawOutput = userConfig.output;

  const baseRaw: Record<string, unknown> =
    asRecord(Array.isArray(rawOutput) ? rawOutput[0] : rawOutput) ?? {};

  rejectRollupStyleSplitting(rawOutput, baseRaw);

  const format = asString(baseRaw.format) ?? 'es';

  const makeOutputOptions = (o: Record<string, unknown>) =>
    ({
      ...o,
      dir: outputDir,
      entryFileNames: entryFileName(format),
    }) as TOutput;

  const baseOutputOptions = makeOutputOptions(baseRaw);

  const bundle = await bundler(inputOptions);

  try {
    await bundle.write(baseOutputOptions);
  } finally {
    await bundle.close();
  }

  assertEntryFileEmitted(outputDir, format);
  writeBundleMeta(outputDir, format);
};

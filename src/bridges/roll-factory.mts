import { asRecord, asString } from './config.ts';
import { assertSingleEntryFile, rejectRollupStyleSplitting } from './guard.ts';
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

  // userConfig is an arbitrary module validated only as an object; assert the
  // bundler input shape when merging the CDK-controlled entry into it.
  const inputOptions = {
    ...userConfig,
    input: entry,
  } as TInput;

  const rawOutput = userConfig.output;
  // Fall back to {} in both branches so an explicit empty `output: []` does not
  // leave baseRaw undefined (which would crash the `baseRaw.format` read below).
  const baseRaw: Record<string, unknown> =
    asRecord(Array.isArray(rawOutput) ? rawOutput[0] : rawOutput) ?? {};

  // Reject multi-output configs (extra outputs collide in the single asset dir)
  // and the splitting knobs that would emit sibling chunks the asset never ships.
  rejectRollupStyleSplitting(rawOutput, baseRaw);

  // Rollup and Rolldown both default output.format to 'es' when it is omitted,
  // so a missing format means an ESM bundle. Default to 'es' here rather than
  // recording null, otherwise the parent would skip writing `type: module` and
  // the ESM handler would fail to load at runtime. Format detection uses the
  // first (base) output only; the Lambda handler is always a single entry.
  const format = asString(baseRaw.format) ?? 'es';

  const makeOutputOptions = (o: Record<string, unknown>) =>
    ({
      ...o,
      dir: outputDir,
      entryFileNames: entryFileName(format),
    }) as TOutput;

  const baseOutputOptions = makeOutputOptions(baseRaw);

  const bundle = await bundler(inputOptions);
  // Release the bundle handle even if write() throws, otherwise the handle leaks.
  try {
    await bundle.write(baseOutputOptions);
  } finally {
    await bundle.close();
  }
  // Backstop for dynamic import() splitting, which manualChunks/preserveModules
  // checks above cannot detect from config.
  assertSingleEntryFile(outputDir, format);
  writeBundleMeta(outputDir, format);
};

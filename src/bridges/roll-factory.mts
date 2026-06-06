import { getArgs } from './get-args.ts';
import { assertSingleEntryFile, rejectSplittingOption } from './guard.ts';
import { entryFileName, writeBundleMeta } from './write-meta.ts';

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
  // Fall back to {} in both branches so an explicit empty `output: []` does not
  // leave baseRaw undefined (which would crash the `baseRaw.format` read below).
  const baseRaw = (Array.isArray(rawOutput) ? rawOutput[0] : rawOutput) ?? {};
  const extraRaw = Array.isArray(rawOutput) ? rawOutput.slice(1) : [];

  // Reject multi-output configs: every output would be written to the same dir
  // with the same entryFileNames, so the extra outputs overwrite / collide with
  // the first. The Lambda handler is a single file, so only one output is valid.
  if (extraRaw.length > 0) {
    throw new Error(
      'Multiple Rollup/Rolldown outputs are not supported: the Lambda handler is a ' +
        'single file. Provide a single `output` configuration.',
    );
  }

  // Reject splitting options that would emit sibling chunks the asset never ships.
  rejectSplittingOption(baseRaw.manualChunks, 'Rollup/Rolldown output.manualChunks');
  rejectSplittingOption(baseRaw.preserveModules, 'Rollup/Rolldown output.preserveModules');

  // Rollup and Rolldown both default output.format to 'es' when it is omitted,
  // so a missing format means an ESM bundle. Default to 'es' here rather than
  // recording null, otherwise the parent would skip writing `type: module` and
  // the ESM handler would fail to load at runtime. Format detection uses the
  // first (base) output only; the Lambda handler is always a single entry.
  const format: string = baseRaw.format ?? 'es';

  const makeOutputOptions = (o: object) =>
    ({
      ...o,
      dir: outputDir,
      entryFileNames: entryFileName(format),
    }) as TOutput;

  const baseOutputOptions = makeOutputOptions(baseRaw);

  const bundle = await bundler(inputOptions);
  await bundle.write(baseOutputOptions);
  await bundle.close();
  // Backstop for dynamic import() splitting, which manualChunks/preserveModules
  // checks above cannot detect from config.
  assertSingleEntryFile(outputDir, format);
  writeBundleMeta(outputDir, format);
};

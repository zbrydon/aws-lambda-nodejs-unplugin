import { getArgs } from './get-args.ts';
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
  for (const o of extraRaw) {
    await bundle.write(makeOutputOptions(o));
  }
  await bundle.close();
  writeBundleMeta(outputDir, format);
};

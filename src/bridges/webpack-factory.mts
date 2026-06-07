import { asRecord } from './config.ts';
import { assertSingleEntryFile, rejectSplitChunks, rejectSplittingOption } from './guard.ts';
import { loadBridgeContext } from './load-context.ts';
import { entryFileName, writeBundleMeta } from './write-meta.ts';

/** Minimal structural shape of a webpack/rspack Stats object used by the bridge. */
interface BridgeStats {
  hasErrors(): boolean;
  toString(options?: unknown): string;
}

/** Minimal structural shape of a webpack/rspack Compiler used by the bridge. */
export interface BridgeCompiler {
  run(callback: (err: Error | null | undefined, stats?: BridgeStats) => void): void;
  close(callback: (err?: Error | null) => void): void;
}

/**
 * Shared runner for the webpack and rspack bridges, which differ only in the
 * compiler they instantiate (mirroring `runRollBridge` for rollup/rolldown).
 * Keeping the ESM-detection and chunk-rejection logic in one place stops the two
 * bridges from silently diverging.
 */
export const runWebpackBridge = async (
  compilerFactory: (config: Record<string, unknown>) => BridgeCompiler,
): Promise<void> => {
  const { entry, outputDir, userConfig } = await loadBridgeContext();

  const output = asRecord(userConfig.output);
  const experiments = asRecord(userConfig.experiments);
  const optimization = asRecord(userConfig.optimization);

  // Emit ESM when output.module is true (which also requires
  // experiments.outputModule). Accept either signal so a config that enables ESM
  // via experiments.outputModule alone is not mislabelled and shipped as CJS.
  const format = output?.module === true || experiments?.outputModule === true ? 'esm' : undefined;

  // Reject chunk-splitting options that would emit sibling chunks the asset never ships.
  rejectSplitChunks(optimization?.splitChunks, 'optimization.splitChunks');
  rejectSplittingOption(optimization?.runtimeChunk, 'optimization.runtimeChunk');

  const finalConfig: Record<string, unknown> = {
    ...userConfig,
    entry,
    output: {
      ...output,
      path: outputDir,
      filename: entryFileName(format),
      // Force output.module for ESM. webpack derives this from
      // experiments.outputModule, but rspack does not - without it rspack emits a
      // CJS bundle into index.mjs that fails to load at runtime. Setting it is
      // valid and safe for webpack too (both signals are set below).
      ...(format === 'esm' ? { module: true } : {}),
    },
    // ESM output also requires experiments.outputModule; inject it so a config
    // that sets only output.module does not error.
    ...(format === 'esm' ? { experiments: { ...experiments, outputModule: true } } : {}),
  };

  const compiler = compilerFactory(finalConfig);

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
  // Backstop for dynamic import() splitting, undetectable from config.
  assertSingleEntryFile(outputDir, format);
  writeBundleMeta(outputDir, format);
};

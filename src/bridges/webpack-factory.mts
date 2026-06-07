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

  const format = output?.module === true || experiments?.outputModule === true ? 'esm' : undefined;

  rejectSplitChunks(optimization?.splitChunks, 'optimization.splitChunks');
  rejectSplittingOption(optimization?.runtimeChunk, 'optimization.runtimeChunk');

  const finalConfig: Record<string, unknown> = {
    ...userConfig,
    entry,
    output: {
      ...output,
      path: outputDir,
      filename: entryFileName(format),

      ...(format === 'esm' ? { module: true } : {}),
    },

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

  assertSingleEntryFile(outputDir, format);
  writeBundleMeta(outputDir, format);
};

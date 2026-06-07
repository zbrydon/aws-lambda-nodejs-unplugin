import { readdirSync } from 'node:fs';
import { isRecord } from '../util.ts';
import { entryFileName } from './write-meta.ts';

/**
 * Rejects a code-splitting config option that is set to anything other than a
 * "disabled" value. The Lambda handler is staged as a single file, so any
 * splitting (manual chunks, split chunks, preserved modules, multiple outputs)
 * would leave the entry referencing sibling chunks that the asset never ships.
 *
 * Mirrors esbuild's existing rejection of `splitting`, applied to the equivalent
 * option on the other bundlers. Fails early with an actionable message instead
 * of producing a broken Lambda.
 */
export const rejectSplittingOption = (value: unknown, label: string): void => {
  if (value === undefined || value === null || value === false) {
    return;
  }
  // An empty object / array is treated as "not configured".
  if (typeof value === 'object' && Object.keys(value as object).length === 0) {
    return;
  }
  throw new Error(
    `${label} is not supported: the Lambda handler is emitted as a single file. ` +
      'Remove it from your bundler config (or pre-bundle and pass that file as `entry`).',
  );
};

/** webpack/rspack `optimization.splitChunks.chunks` values that split the entry chunk. */
const ENTRY_SPLITTING_CHUNKS: ReadonlySet<string> = new Set(['all', 'initial']);

/**
 * splitChunks-specific guard for webpack/rspack. Unlike `manualChunks` or
 * `runtimeChunk` - which emit sibling chunks whenever they are set - a
 * `splitChunks` config only pulls modules out of the single handler entry when
 * its `chunks` is `'all'` or `'initial'` (top-level or in a cacheGroup). The
 * default `'async'` splits only dynamically-imported chunks, which the
 * post-build `assertSingleEntryFile` backstop catches. So accept the benign
 * cases up front and reject only the values that would split the entry file.
 */
export const rejectSplitChunks = (value: unknown, label: string): void => {
  if (!isRecord(value)) {
    // false / undefined / any non-object: nothing that splits the entry chunk.
    return;
  }
  const splitsEntry = (cfg: Record<string, unknown>): boolean =>
    typeof cfg.chunks === 'string' && ENTRY_SPLITTING_CHUNKS.has(cfg.chunks);
  const cacheGroups = isRecord(value.cacheGroups) ? Object.values(value.cacheGroups) : [];
  if (splitsEntry(value) || cacheGroups.some((group) => isRecord(group) && splitsEntry(group))) {
    throw new Error(
      `${label} is not supported: the Lambda handler is emitted as a single file. ` +
        "Remove `chunks: 'all' | 'initial'` (or pre-bundle and pass that file as `entry`).",
    );
  }
};

/**
 * Backstop run after a bundle is written: the asset directory must contain only
 * the single entry file (`index.js` / `index.mjs`). Any additional JS chunk
 * means the bundler split the output - including via dynamic `import()`, which
 * cannot be detected from config alone - and the single-file Lambda asset model
 * cannot ship it. Throws with the offending file names.
 */
export const assertSingleEntryFile = (outputDir: string, format: string | undefined): void => {
  const entry = entryFileName(format);
  const extras = readdirSync(outputDir).filter(
    (file) => /\.(js|mjs|cjs)$/.test(file) && file !== entry,
  );
  if (extras.length > 0) {
    throw new Error(
      `Code splitting is not supported: the bundler emitted extra chunk file(s) ` +
        `[${extras.join(', ')}] alongside ${entry}. The Lambda asset ships a single ` +
        'handler file. Remove manualChunks / splitChunks / preserveModules and avoid ' +
        'dynamic import() splitting in your bundler config.',
    );
  }
};

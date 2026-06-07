import { readdirSync } from 'node:fs';
import { isRecord } from '../util.ts';
import { entryFileName } from './write-meta.ts';

const SINGLE_FILE_REASON = 'the Lambda handler is emitted as a single file';
const DEFAULT_REMEDY =
  'Remove it from your bundler config (or pre-bundle and pass that file as `entry`).';

const splittingMessage = (label: string, remedy: string = DEFAULT_REMEDY): string =>
  `${label} is not supported: ${SINGLE_FILE_REASON}. ${remedy}`;

export const rejectSplittingOption = (value: unknown, label: string): void => {
  if (value === undefined || value === null || value === false) {
    return;
  }

  if (typeof value === 'object' && Object.keys(value as object).length === 0) {
    return;
  }
  throw new Error(splittingMessage(label));
};

export const rejectRollupStyleSplitting = (
  rawOutput: unknown,
  baseOutput: Record<string, unknown> | undefined,
  label = 'Rollup/Rolldown',
): void => {
  if (Array.isArray(rawOutput) && rawOutput.length > 1) {
    throw new Error(
      `Multiple ${label} outputs are not supported: ${SINGLE_FILE_REASON}. ` +
        'Provide a single `output` configuration.',
    );
  }
  rejectSplittingOption(baseOutput?.manualChunks, `${label} output.manualChunks`);
  rejectSplittingOption(baseOutput?.preserveModules, `${label} output.preserveModules`);
};

const ENTRY_SPLITTING_CHUNKS: ReadonlySet<string> = new Set(['all', 'initial']);

export const rejectSplitChunks = (value: unknown, label: string): void => {
  if (!isRecord(value)) {
    return;
  }
  const splitsEntry = (cfg: Record<string, unknown>): boolean =>
    typeof cfg.chunks === 'string' && ENTRY_SPLITTING_CHUNKS.has(cfg.chunks);
  const cacheGroups = isRecord(value.cacheGroups) ? Object.values(value.cacheGroups) : [];
  if (splitsEntry(value) || cacheGroups.some((group) => isRecord(group) && splitsEntry(group))) {
    throw new Error(
      splittingMessage(
        label,
        "Remove `chunks: 'all' | 'initial'` (or pre-bundle and pass that file as `entry`).",
      ),
    );
  }
};

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

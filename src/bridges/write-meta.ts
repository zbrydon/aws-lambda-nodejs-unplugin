import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const isEsmFormat = (format: string | undefined): boolean =>
  format === 'esm' || format === 'es';

export const entryFileName = (format: string | undefined): string =>
  isEsmFormat(format) ? 'index.mjs' : 'index.js';

export const writeBundleMeta = (outputDir: string, format: string | undefined): void => {
  writeFileSync(join(outputDir, '.lambda-bundle-meta'), JSON.stringify({ format: format ?? null }));
};

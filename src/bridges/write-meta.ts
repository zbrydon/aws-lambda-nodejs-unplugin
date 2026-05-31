import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const writeBundleMeta = (outputDir: string, format: string | undefined): void => {
  writeFileSync(join(outputDir, '.lambda-bundle-meta'), JSON.stringify({ format: format ?? null }));
};

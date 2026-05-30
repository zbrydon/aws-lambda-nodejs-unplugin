import { writeFileSync } from 'fs';
import { join } from 'path';

export const writeBundleMeta = (outputDir: string, format: string | undefined): void => {
  writeFileSync(join(outputDir, '.lambda-bundle-meta'), JSON.stringify({ format: format ?? null }));
};

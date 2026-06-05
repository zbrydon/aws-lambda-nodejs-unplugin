import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** True when a bundler output format string denotes ES modules. */
export const isEsmFormat = (format: string | undefined): boolean =>
  format === 'esm' || format === 'es';

/**
 * Entry output filename for the given module format. ESM uses a `.mjs`
 * extension so the Lambda runtime loads the handler as an ES module from the
 * extension alone (mirroring `aws_lambda_nodejs.NodejsFunction`); CJS uses
 * `.js`. The Lambda handler string stays `index.<fn>` either way — the runtime
 * resolves the extension.
 */
export const entryFileName = (format: string | undefined): string =>
  isEsmFormat(format) ? 'index.mjs' : 'index.js';

export const writeBundleMeta = (outputDir: string, format: string | undefined): void => {
  writeFileSync(join(outputDir, '.lambda-bundle-meta'), JSON.stringify({ format: format ?? null }));
};

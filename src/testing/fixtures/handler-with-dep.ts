import * as zod from 'zod';

/**
 * Fixture handler that imports from `zod`.
 *
 * Used by the externals integration test to verify that a module listed in
 * `nodeModules` is excluded from the bundle (marked external by the plugin)
 * and installed separately in the Lambda output directory.
 */
export const handler = async (event: unknown) => ({
  event,
  // Object.keys confirms the external module loaded correctly at runtime.
  zodExports: Object.keys(zod).sort(),
});

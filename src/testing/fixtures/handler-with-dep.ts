import { createUnplugin } from 'unplugin';

/**
 * Fixture handler that imports from `unplugin`.
 *
 * Used by the externals integration test to verify that a module listed in
 * `nodeModules` is excluded from the bundle (marked external by the plugin)
 * and installed separately in the Lambda output directory.
 */
const noop = createUnplugin(() => ({ name: 'noop' }));

export const handler = async (event: unknown) => ({
  event,
  // Object.keys confirms the external module loaded correctly at runtime.
  bundlerKeys: Object.keys(noop).sort(),
});

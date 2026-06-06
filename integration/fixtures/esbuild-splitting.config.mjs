/**
 * esbuild config that enables code splitting, which the single-file Lambda asset
 * model does not support. The esbuild bridge must reject this before building.
 */
export default {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  splitting: true,
};

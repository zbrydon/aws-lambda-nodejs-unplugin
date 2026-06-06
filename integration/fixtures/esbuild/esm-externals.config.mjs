/**
 * esbuild ESM output with `constructs` marked external, to exercise the
 * ESM + externals + `type: module` install path.
 */
export default {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['constructs'],
};

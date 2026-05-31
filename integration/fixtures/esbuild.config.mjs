/**
 * esbuild config for the Lambda function.
 *
 * Entry point and output path are injected by the CDK bundling driver at
 * synthesis time. For local dev builds add them directly:
 *   entryPoints: ['src/handler.ts'],
 *   outfile: 'dist/index.js',
 */
export default {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
};

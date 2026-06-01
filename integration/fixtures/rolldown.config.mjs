/**
 * Rolldown config for the Lambda function.
 *
 * Rolldown handles TypeScript natively via Oxc, so no separate TS plugin is
 * needed (unlike the rollup fixture which uses an inline esbuild transform).
 *
 * Input and output.dir are injected by the CDK bundling driver at synthesis
 * time. For local dev builds add them directly:
 *   input: 'src/handler.ts',
 *   output: { dir: 'dist', ... },
 */
export default {
  output: {
    entryFileNames: 'index.js',
    format: 'cjs',
  },
  external: [/^node:/],
};

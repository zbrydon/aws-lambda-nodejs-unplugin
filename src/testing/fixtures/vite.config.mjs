/**
 * Vite config for the Lambda function.
 *
 * Entry (build.ssr) and output directory (build.outDir) are injected by the
 * CDK bundling driver at synthesis time. For local dev builds add them directly:
 *   build: { ssr: 'src/handler.ts', outDir: 'dist', ... },
 */
export default {
  build: {
    // SSR mode produces a single CJS bundle with full control over the filename.
    emptyOutDir: false,
    target: 'node24',
    // rolldownOptions is the Vite 6+ API; rollupOptions is deprecated.
    rolldownOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'index.js',
      },
    },
  },
};

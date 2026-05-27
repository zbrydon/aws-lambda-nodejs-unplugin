import { transformSync } from 'esbuild';

/**
 * Inline rollup plugin that transpiles TypeScript via esbuild.
 * Production configs would typically use @rollup/plugin-typescript or
 * rollup-plugin-esbuild instead.
 */
const typescriptPlugin = {
  name: 'esbuild-typescript',
  transform(code, id) {
    if (!/\.[mc]?ts$/.test(id)) {
      return null;
    }
    const result = transformSync(code, { loader: 'ts', target: 'node24', sourcemap: true });
    return { code: result.code, map: result.map };
  },
};

/**
 * Rollup config for the Lambda function.
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
  plugins: [typescriptPlugin],
};

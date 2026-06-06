import { transformSync } from 'esbuild';

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
 * Rollup config with an explicitly empty `output: []`. The roll-factory bridge
 * must fall back to a single default output (format defaults to 'es' -> ESM) and
 * still produce one handler file.
 */
export default {
  output: [],
  external: [/^node:/],
  plugins: [typescriptPlugin],
};

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
 * Rollup config with multiple outputs. The single-file Lambda asset cannot ship
 * more than one output (they would collide on the same dir + entryFileNames), so
 * the roll-factory bridge must reject this.
 */
export default {
  output: [{ format: 'es' }, { format: 'cjs' }],
  external: [/^node:/],
  plugins: [typescriptPlugin],
};

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

export default {
  output: {
    entryFileNames: 'index.js',
    format: 'cjs',
  },
  external: [/^node:/, 'zod'],
  plugins: [typescriptPlugin],
};

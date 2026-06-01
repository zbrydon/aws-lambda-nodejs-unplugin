# Bundler configs

Each bundler requires a config file that exports a default configuration object. The CDK bundling driver imports that object at synthesis time, merges in the CDK-controlled entry point and output directory, and calls the bundler's JavaScript API directly.

Your config does **not** need to:

- Read env vars for the entry or output path (the driver injects those).
- Import `createLambdaUnplugin` (the driver handles externals internally).

Because the config is a plain object export, the same file works for local dev builds: just add `entryPoints`/`input`/`entry` and `outfile`/`output.dir`/`output.path` for the paths you want locally. The driver overrides those fields at synthesis time.

---

## esbuild

**Install:**

```sh
pnpm add -D esbuild
```

**`build.mjs`:**

```js
export default {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  // Add for local dev builds (overridden by CDK at synthesis time):
  // entryPoints: ['src/handler.ts'],
  // outfile: 'dist/index.js',
};
```

**CDK construct:**

```ts
new NodejsFunction(this, 'my-fn', {
  bundling: {
    bundler: 'esbuild',
    bundlerConfig: 'build.mjs',
  },
});
```

---

## Vite

**Install:**

```sh
pnpm add -D vite
```

**`vite.lambda.config.mjs`:**

```js
export default {
  build: {
    // SSR mode produces a single CJS bundle with full control over the filename.
    emptyOutDir: false,
    target: 'node24',
    rolldownOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'index.js',
      },
    },
    // Add for local dev builds (overridden by CDK at synthesis time):
    // ssr: 'src/handler.ts',
    // outDir: 'dist',
  },
};
```

**CDK construct:**

```ts
new NodejsFunction(this, 'my-fn', {
  bundling: {
    bundler: 'vite',
    bundlerConfig: 'vite.lambda.config.mjs',
  },
});
```

---

## Rollup

**Install:**

```sh
pnpm add -D rollup
```

**`rollup.lambda.config.mjs`:**

```js
export default {
  output: {
    entryFileNames: 'index.js',
    format: 'cjs',
  },
  external: [/^node:/],
  // Add for local dev builds (overridden by CDK at synthesis time):
  // input: 'src/handler.ts',
  // output: { dir: 'dist', ... },
};
```

**CDK construct:**

```ts
new NodejsFunction(this, 'my-fn', {
  bundling: {
    bundler: 'rollup',
    bundlerConfig: 'rollup.lambda.config.mjs',
  },
});
```

---

## Rolldown

**Install:**

```sh
pnpm add -D rolldown
```

**`rolldown.lambda.config.mjs`:**

```js
export default {
  output: {
    entryFileNames: 'index.js',
    format: 'cjs',
  },
  external: [/^node:/],
  // Add for local dev builds (overridden by CDK at synthesis time):
  // input: 'src/handler.ts',
  // output: { dir: 'dist', ... },
};
```

**CDK construct:**

```ts
new NodejsFunction(this, 'my-fn', {
  bundling: {
    bundler: 'rolldown',
    bundlerConfig: 'rolldown.lambda.config.mjs',
  },
});
```

---

## webpack

**Install:**

```sh
pnpm add -D webpack
```

**`webpack.lambda.config.mjs`:**

```js
export default {
  module: {
    rules: [{ test: /\.[mc]?ts$/, use: 'ts-loader' }],
  },
  resolve: { extensions: ['.ts', '.js'] },
  output: {
    // filename is always set to 'index.js' by the CDK bundling driver.
    library: { type: 'commonjs2' },
  },
  target: 'node',
  mode: 'production',
  // Add for local dev builds (overridden by CDK at synthesis time):
  // entry: './src/handler.ts',
  // output: { path: path.resolve('dist'), ... },
};
```

**CDK construct:**

```ts
new NodejsFunction(this, 'my-fn', {
  bundling: {
    bundler: 'webpack',
    bundlerConfig: 'webpack.lambda.config.mjs',
  },
});
```

---

## Rspack

**Install:**

```sh
pnpm add -D @rspack/core @rspack/cli
```

**`rspack.lambda.config.mjs`:**

```js
export default {
  module: {
    rules: [{ test: /\.[mc]?ts$/, use: 'builtin:swc-loader' }],
  },
  resolve: { extensions: ['.ts', '.js'] },
  output: {
    // filename is always set to 'index.js' by the CDK bundling driver.
    library: { type: 'commonjs2' },
  },
  target: 'node',
  mode: 'production',
  // Add for local dev builds (overridden by CDK at synthesis time):
  // entry: './src/handler.ts',
  // output: { path: path.resolve('dist'), ... },
};
```

**CDK construct:**

```ts
new NodejsFunction(this, 'my-fn', {
  bundling: {
    bundler: 'rspack',
    bundlerConfig: 'rspack.lambda.config.mjs',
  },
});
```

---

## Farm

**Install:**

```sh
pnpm add -D @farmfe/core
```

**`farm.lambda.config.mjs`:**

```js
export default {
  compilation: {
    output: {
      format: 'cjs',
      targetEnv: 'node',
    },
    external: ['^node:.*'],
    sourcemap: false,
    minify: false,
    // Add for local dev builds (overridden by CDK at synthesis time):
    // input: { index: 'src/handler.ts' },
    // output: { path: 'dist', ... },
  },
};
```

`entryFilename` is enforced by the driver (`[entryName].js`) and does not need to be set in your config.

**CDK construct:**

```ts
new NodejsFunction(this, 'my-fn', {
  bundling: {
    bundler: 'farm',
    bundlerConfig: 'farm.lambda.config.mjs',
  },
});
```

---

## Externals

When using `nodeModules`, you must mark those packages as external in your bundler config so they are excluded from the bundle. Each bundler uses a different key.

**esbuild**

```js
export default {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['sharp'],
};
```

**Vite**

```js
export default {
  build: {
    rolldownOptions: {
      external: ['sharp'],
      output: { format: 'cjs', entryFileNames: 'index.js' },
    },
  },
};
```

**Rollup / Rolldown**

```js
export default {
  output: { entryFileNames: 'index.js', format: 'cjs' },
  external: [/^node:/, 'sharp'],
};
```

**webpack / Rspack -- CJS output**

```js
export default {
  // ...
  externals: { sharp: 'commonjs sharp' },
};
```

**webpack / Rspack -- ESM output** (`output.module: true`)

```js
export default {
  experiments: { outputModule: true },
  output: { module: true, library: { type: 'module' } },
  externalsType: 'module',
  externals: { sharp: 'sharp' },
};
```

**Farm**

Farm externals are regex strings. To match a package and its subpaths use `^<name>(/.*)?$`.

```js
export default {
  compilation: {
    external: ['^node:.*', '^sharp(/.*)?$'],
    // ...
  },
};
```

---

## Choosing a bundler

| Bundler  | Notes                                        |
| -------- | -------------------------------------------- |
| esbuild  | Fastest; zero config for plain TS/JS         |
| Vite     | Rollup under the hood; good plugin ecosystem |
| Rollup   | Flexible; best for libraries                 |
| Rolldown | Rollup-compatible, Rust-powered              |
| webpack  | Most mature; largest ecosystem               |
| Rspack   | Rust-powered webpack-compatible              |
| Farm     | Rust-powered; fastest cold start             |

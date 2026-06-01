# Pre-release review: aws-lambda-nodejs-unplugin

Review date: 2026-06-01. Scope: bugs, code quality, comments, escape hatches,
simplification, documentation, architecture, and integration test coverage.

Severity legend: **[H]** high (correctness / release blocker), **[M]** medium
(quality / portability / docs), **[L]** low (nit / hygiene). "Verify" means the
finding needs confirmation against a specific dependency version.

---

## Summary of highest-priority items

1. **[H] `src/bridges/vite.mts`** assumes a Rolldown-based Vite. It drops
   `rollupOptions` and only re-emits `rolldownOptions`, so for any Rollup-based
   Vite (the peer range allows `vite >= 6`) the forced `entryFileNames: index.js`
   and the user's output config are silently ignored — `index.js` is never
   produced. Verify against Vite 6/7.
2. **[H/M] Rollup & Rolldown default-format footgun** (`roll-factory.mts`). When
   the user omits `output.format`, Rollup/Rolldown default to ESM, but the bridge
   records no format, so no `type: module` is written and the Lambda fails to
   load at runtime. Vite/Farm bridges already defensively default; these do not.
3. **[M] Package identity inconsistency** — the dev-export condition string
   `@seek/aws-lambda-nodejs-unplugin/source` (package.json `imports`/`exports`,
   vitest config) does not match the published package name
   `aws-lambda-nodejs-unplugin`. Leftover from a template; confusing, worth
   renaming before first publish.
4. **[M] Integration coverage gaps**: only pnpm is exercised end-to-end;
   `beforeInstall`, corepack, workspace-file copying, multi-PM install, and
   `assetHash` are unit-tested only.

---

## src/ (library)

### src/index.ts

- No issues. Clean public surface (construct, props, options, bundler list).

### src/function.ts

- **[L]** `findEntry` returns the raw (possibly relative) `entry` when supplied;
  the caller wraps it in `path.resolve`. Fine, but the existence check on line
  122 runs against the unresolved path while the doc comment says relative paths
  resolve against cwd — they do, but only implicitly via `existsSync`. Minor.
- **[L]** `findDefiningFile` stack-walking heuristics (super-chain skip + single
  factory-wrapper skip) are intricate and only correct for one level of factory
  nesting. Acceptable and well-commented, but inherently fragile against unusual
  call patterns. Comments here are accurate and useful.
- **[L]** `LOCK_FILES` order (`PNPM, YARN, BUN_LOCK, BUN, NPM`) duplicates the
  ordering encoded in `package-manager.ts#LOCK_FILE_PM`. Two sources of truth for
  lock-file precedence; consider deriving one from the other.
- Comments are accurate (the `$&`/replacer-function and `fileURLToPath` rationale
  comments correspond to real regression tests).

### src/bundling.ts

- **[M]** `JSON.parse(fs.readFileSync(metaPath, ...))` (line 92) is not guarded;
  malformed meta throws before `fs.unlinkSync`, leaving the temp file behind. The
  bridge controls this file so it is low-risk, but a `try/finally` around the
  read+unlink would be more robust.
- **[L]** `detectPackageManager(props.projectRoot)` runs unconditionally at the
  top of `tryBundle` (line 54), even when `nodeModules` is unset and the result
  is unused. When a `packageManager` field is present this also spawns
  `corepack --version` needlessly. Move it inside the `if (props.nodeModules?.length)`
  block.
- **[L]** The signal/status error-detail block is duplicated three times (bundler,
  install, shell). Extract a helper (e.g. `describeExit(result)`).
- Comments accurately describe the bridge-resolution and lock-file rationale.

### src/types.ts

- **[L]** `SupportedBundler` union and `SUPPORTED_BUNDLERS` array are maintained
  by hand and must stay in sync (the `REGISTRY` in `bundlers/index.ts` is a third
  copy). Consider deriving the union from the const array
  (`typeof SUPPORTED_BUNDLERS[number]`) to remove one source of drift.

### src/package-manager.ts

- **[M]** `buildInstallCommand` chooses `npm ci` when `projectRoot/package-lock.json`
  exists, but the install runs in `outputDir` with the lock file copied under
  `path.basename(depsLockFilePath)`. If the caller passed a `depsLockFilePath`
  whose basename is not `package-lock.json`, `npm ci` will fail in `outputDir`.
  Edge case, but the detection (projectRoot) and execution (outputDir + copied
  name) are decoupled.
- **[L]** `getLockFile` for `bun` returns `bun.lock` as a default even when
  neither bun lock file exists; harmless but slightly surprising.
- **[L]** `filterPnpmWorkspaceYaml` is a hand-rolled YAML section parser via
  regex. It is well-tested for the `patchedDependencies` case but will not handle
  nested/flow YAML; acceptable given the narrow scope, but worth a comment that it
  is intentionally line-oriented and not a general YAML parser.
- Detection order and corepack handling match the documentation.

### src/util.ts

- **[L]** `CallSite` interface duplicates Node's `NodeJS.CallSite`; re-declaring is
  reasonable to avoid a hard `@types/node` shape dependency, but worth a one-line
  note that it mirrors the V8 API.
- `extractDependencies` precedence (deps > devDeps > peerDeps), empty-version
  guard, and `file:` resolution are all correct and backed by regression tests.
- No bugs.

### src/errors.ts

- No issues. Minimal, correct.

### src/bundlers/index.ts & src/bundlers/types.ts

- **[L]** `BundlerAdapter.name` is typed as `string` while every value is a
  `SupportedBundler`; tightening to `SupportedBundler` would be more precise.
- Otherwise clean. Comments accurate.

---

## src/bridges/ (spawned at bundle time — note: `.mts`, so NOT covered by the

`**/*.ts` unit coverage include; only exercised by integration tests)

### src/bridges/get-args.ts

- No issues. Zod tuple validation is appropriate.

### src/bridges/write-meta.ts

- No issues.

### src/bridges/esbuild.mts

- **[L/Verify]** `writeBundleMeta(outputDir, restConfig.format)`. esbuild's
  default format for `platform: 'node'` is `cjs`, so omitting `format` is safe in
  practice, but the meta will be `null` rather than `'cjs'`. Consistent with the
  null→non-ESM handling. OK.

### src/bridges/roll-factory.mts (rollup.mts / rolldown.mts)

- **[H/M]** Default-format footgun: Rollup and Rolldown default `output.format`
  to ESM. When the user config omits `format`, `baseRaw.format` is `undefined`,
  `writeBundleMeta` records `null`, no `type: module` is written, and the ESM
  bundle fails to load in Lambda. The Vite and Farm bridges defensively default
  the format; these two should too (or document that `format` is mandatory for
  rollup/rolldown). Docs examples always set `format`, which masks this.
- **[L]** Only `baseRaw.format` (first output) drives the meta; extra outputs are
  written but ignored for format detection. Reasonable for the single-entry Lambda
  use case but undocumented.

### src/bridges/vite.mts

- **[H/Verify]** Writes only `rolldownOptions` and destructures **both**
  `rollupOptions` and `rolldownOptions` out of the user build config. For a
  Rollup-based Vite (peer range allows `vite >= 6`; Rolldown is not Vite's
  bundler in all supported versions), the canonical key is `rollupOptions`, so
  the forced `entryFileNames: 'index.js'` and the merged output options are
  applied under a key Vite ignores — `index.js` is never emitted and `tryBundle`
  still returns `true`. The integration fixture passes only because the dev
  dependency `vite@8.0.14` is Rolldown-based. Either narrow the peer range to the
  Rolldown-based Vite versions or emit `rollupOptions` when the resolved Vite is
  Rollup-based.
- **[M]** README's Vite example uses `rollupOptions` while `docs/bundlers.md` uses
  `rolldownOptions`; pick one and align with whatever the bridge actually honours.

### src/bridges/webpack.mts & rspack.mts

- **[M]** ESM detection is `userConfig.output?.module === true` only. A user who
  configures ESM via `experiments.outputModule` + `library.type: 'module'` but
  without literally `output.module: true` would not get `type: module`. Matches
  the documented externals recipe (which does set `output.module: true`), so
  acceptable, but the detection is narrower than the webpack/rspack ways to emit
  ESM.
- rspack correctly closes the compiler on every path (success, stats error, run
  error). Good.

### src/bridges/farm.mts

- No issues. Enforces `entryFilename: '[entryName].js'`; integration-tested.

---

## Tests

### Unit tests

- Excellent coverage with enforced 100% thresholds (branches/functions/lines/
  statements). Regression tests document real past bugs (`$&` replacement, file://
  normalisation, dependency precedence, empty-version guard, lock-file basename,
  bun.lockb).
- **[M]** Coverage `include: ['**/*.ts']` does not match the `.mts` bridge files,
  so the bridge logic (roll-factory format defaulting, vite option remapping,
  webpack/rspack ESM detection) is **not** measured by the 100% gate and is
  validated only by integration tests. Worth calling out — the two highest-risk
  findings above live in uncovered-by-unit-tests code.

### Integration tests — coverage assessment

Present and good:

- `bundling.test.ts` — all 7 bundlers, CJS passthrough, handler callable.
- `esm.test.ts` — all 7 bundlers ESM + `type:module`; esbuild ESM + nodeModules.
- `externals.test.ts` — all 7 bundlers externals + nodeModules install; multi-
  package (esbuild); webpack/rspack ESM externals; Farm filename enforcement.
- `appStack.test.ts` — CFN snapshot per bundler (bundling suppressed).
- `autoEntry.test.ts` — callsite auto-detection + full `app.synth()` end-to-end.
- `commandHooks.test.ts` — before/after hooks + failure paths (esbuild).

Gaps:

- **[M]** Only pnpm is exercised end-to-end (`BASE_BUNDLING_PROPS` hardcodes
  `pnpm-lock.yaml`). No integration test installs `nodeModules` with npm, yarn, or
  bun, so `buildInstallCommand` variants and the `npm ci` vs `npm install` choice
  are unit-tested only.
- **[M]** `beforeInstall` hook has no end-to-end test (the integration hook tests
  don't set `nodeModules`, so `beforeInstall` never fires there).
- **[M]** Corepack-active install path is not integration-tested.
- **[M]** Workspace-file copying / `filterPnpmWorkspaceYaml` (monorepo
  `catalog:`/`workspace:`/patched deps) is unit-tested but not exercised through a
  real install.
- **[L]** `assetHash` is only asserted as "defined" in unit tests; no test
  confirms `AssetHashType.CUSTOM` vs `OUTPUT` selection behaviour.

---

## Architecture assessment

Overall the design is sound and the separation is clean:

- **Construct layer** (`function.ts`) handles CDK surface, validation, entry/lock
  resolution, then delegates to `Bundling`.
- **Bundling orchestration** (`bundling.ts`) implements `cdk.BundlingOptions`
  with a no-op Docker image and a local `tryBundle`, sequencing hooks → bridge →
  meta → nodeModules install. This is a faithful mirror of the CDK built-in's
  shape.
- **Bridge subprocess model** — spawning `node dist/bridges/<bundler>.mjs` and
  letting Node's resolver walk up to the user's `node_modules` for peer deps is a
  neat way to avoid temp files and keep bundlers as optional peers. The bridges
  are kept thin and uniform (import config → merge entry/output → run → write
  meta).
- **Meta file handshake** (`.lambda-bundle-meta`) to communicate output format
  back to the parent is pragmatic given the process boundary.

Strengths: optional peer deps, no bundler hardcoding, drop-in `lambda.Function`
subclass, defensive runtime validation, strong unit discipline.

Architectural risks / observations:

- **Triplicated bundler list** (union type, const array, registry) — drift risk;
  collapse to one source.
- **Format detection is per-bridge and inconsistent** — Vite/Farm default a
  format, Rollup/Rolldown/esbuild/webpack/rspack do not. This inconsistency is the
  root of finding #2. A shared convention (always resolve a concrete format, never
  emit `null` when the bundler's own default is ESM) would remove a class of
  runtime-load bugs.
- **Vite bridge couples to Rolldown** while the peer range advertises broader Vite
  support (finding #1). Either tighten the peer range or branch on the resolved
  Vite flavour.
- **PM detection vs. execution split** — detection keys off `projectRoot` while
  install runs in `outputDir` with a renamed lock file; mostly fine but the `npm
ci` path is the fragile seam.

---

## Documentation

- **[M]** README Vite snippet uses `rollupOptions`; `docs/bundlers.md` uses
  `rolldownOptions`. Align, and make the choice consistent with the bridge.
- **[L]** `docs/advanced.md` "Package manager detection" says the driver reads
  `projectRoot/package.json`, which is correct for PM detection, but
  `nodeModules` version extraction (`extractDependencies`) actually reads the
  `package.json` found by walking up from the **entry** directory, not
  necessarily `projectRoot`. In a monorepo these can differ; the docs gloss over
  it.
- **[L]** Docs/JSDoc do not mention that `format` is effectively required for the
  rollup/rolldown configs to get correct ESM `type:module` handling (see finding
  #2). Until the bridges default it, this should be documented.
- **[L]** `engines.node: >=24.14.0` is a high floor (relies on native TS support /
  modern Node). Intentional, but worth an explicit note in Getting Started so
  consumers aren't surprised.
- Otherwise docs are thorough, accurate, and match the code (hooks ordering,
  install commands table, auto-detection, assetHash, monorepo guidance).

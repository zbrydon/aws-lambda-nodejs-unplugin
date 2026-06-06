export const SUPPORTED_BUNDLERS = [
  'esbuild',
  'vite',
  'rollup',
  'rolldown',
  'webpack',
  'rspack',
  'farm',
] as const;

export type SupportedBundler = (typeof SUPPORTED_BUNDLERS)[number];

export interface ICommandHooks {
  beforeBundling(inputDir: string, outputDir: string): string[];
  afterBundling(inputDir: string, outputDir: string): string[];
  beforeInstall(inputDir: string, outputDir: string): string[];
}

export interface BundlingOptions {
  /** Which bundler to use. Required; no auto-detection. */
  bundler: SupportedBundler;
  /** Absolute or project-relative path to the bundler config file. */
  bundlerConfig: string;
  /** npm packages to install alongside the bundle rather than embedding them. */
  nodeModules?: string[];
  /** Shell commands to run before/after bundling and before install. */
  commandHooks?: ICommandHooks;
  /** Custom asset hash; if omitted the hash is derived from output content. */
  assetHash?: string;
  /**
   * Maximum time in milliseconds any spawned subprocess (bundler, package
   * manager install, or command hook) may run before it is killed and the
   * bundle fails. Omit for no timeout.
   */
  timeout?: number;
  /**
   * Disable package lifecycle scripts (e.g. `postinstall`) during the
   * `nodeModules` install, as defense-in-depth against a compromised transitive
   * dependency. Implemented by injecting the setting into the staged
   * package-manager config (`.npmrc` `ignore-scripts=true` for npm/pnpm,
   * `.yarnrc.yml` `enableScripts: false` for yarn). Has no effect for bun.
   * Defaults to false to match upstream `NodejsFunction` behavior.
   */
  ignoreScripts?: boolean;
}

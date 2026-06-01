import type { SupportedBundler } from '../types.ts';

export interface BundlerAdapter {
  /** Bundler name. */
  readonly name: SupportedBundler;
  /**
   * Absolute path to the pre-built ESM bridge script for this bundler.
   *
   * The caller spawns `node [bridgeScriptPath] [configPath] [entry] [outputDir]`.
   * The script imports the user-supplied config, merges CDK-controlled entry/output values,
   * then calls the bundler's JS API.
   *
   * The script lives inside the package's `dist/bridges/` directory, which sits within the
   * user's `node_modules` tree, so Node's ESM resolver naturally walks up to find the
   * bundler peer deps without any temp-file copying.
   */
  readonly bridgeScriptPath: string;
}

// oxlint-disable no-console
/**
 * CPU profile script for 0x flame graph analysis.
 *
 * Run with:
 *   pnpm profile
 *
 * This exercises the synchronous hot paths that run during CDK synth for
 * every NodejsFunction construct:
 *
 *   - findUpMultiple  : walks the directory tree looking for lock files
 *   - extractDependencies : reads and parses package.json for nodeModules versions
 *   - detectPackageManager: reads package.json + scans for lock files
 *   - callsites          : captures the V8 stack via Error.prepareStackTrace
 *
 * Outputs timing to stdout so you can sanity-check the run before opening
 * the generated flame graph.
 */

import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { callsites, extractDependencies, findUpMultiple } from '../src/util.ts';
import { detectPackageManager } from '../src/package-manager.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_JSON = path.join(ROOT, 'package.json');
// Start the walk from a nested directory so findUpMultiple has several levels
// to traverse before it finds the lock file at the project root.
const DEEP_DIR = path.join(ROOT, 'src', 'bundlers');
const ITERATIONS = 2_000;

console.log(`Profiling ${ITERATIONS} iterations...`);
console.time('total');

for (let i = 0; i < ITERATIONS; i++) {
  // Simulates the lock-file search done in NodejsFunction.findLockFile().
  findUpMultiple(
    ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lock', 'bun.lockb'],
    DEEP_DIR,
  );

  // Simulates the dependency extraction done when nodeModules is supplied.
  extractDependencies(PKG_JSON, ['esbuild', 'rollup', 'vite']);

  // Simulates the package manager detection done inside Bundling.tryBundle().
  detectPackageManager(ROOT);

  // Simulates the caller-file detection done in the NodejsFunction constructor.
  callsites();
}

console.timeEnd('total');

'use strict';
/**
 * Minimal webpack loader that transpiles TypeScript via esbuild.
 * Used exclusively by the webpack integration test fixture.
 */
const { transformSync } = require('esbuild');

module.exports = function esbuildLoader(source) {
  const result = transformSync(source, { loader: 'ts', target: 'node24' });
  return result.code;
};

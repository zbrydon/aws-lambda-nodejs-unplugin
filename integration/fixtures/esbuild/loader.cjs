'use strict';
const { transformSync } = require('esbuild');

module.exports = function esbuildLoader(source) {
  const result = transformSync(source, { loader: 'ts', target: 'node24' });
  return result.code;
};

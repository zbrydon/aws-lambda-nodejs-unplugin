import { describe, expect, it } from 'vitest';
import { SUPPORTED_BUNDLERS } from '../types.ts';
import { getBundler } from './index.ts';

describe('getBundler', () => {
  it.each(SUPPORTED_BUNDLERS)('returns an adapter for bundler: %s', (bundler) => {
    const adapter = getBundler(bundler);
    expect(adapter).toBeDefined();
    expect(adapter.name).toBe(bundler);
    expect(adapter.bridgeScriptPath).toBeTypeOf('string');
    expect(adapter.bridgeScriptPath).toMatch(new RegExp(`${bundler}\\.mjs$`));
  });
});

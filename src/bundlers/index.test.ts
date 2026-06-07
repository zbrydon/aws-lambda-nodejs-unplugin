import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors.ts';
import type { SupportedBundler } from '../types.ts';
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

  it('throws a ValidationError for an unknown bundler name', () => {
    expect(() => getBundler('nope' as SupportedBundler)).toThrow(ValidationError);
    expect(() => getBundler('nope' as SupportedBundler)).toThrow(/Unknown bundler/);
  });
});

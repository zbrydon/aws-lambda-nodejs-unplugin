import { describe, expect, it } from 'vitest';
import { asRecord, asString } from './config.ts';

describe('asRecord', () => {
  it('returns the value for a plain object', () => {
    const obj = { a: 1 };
    expect(asRecord(obj)).toBe(obj);
  });

  it('returns undefined for null, arrays, and primitives', () => {
    expect(asRecord(null)).toBeUndefined();
    expect(asRecord([1, 2])).toBeUndefined();
    expect(asRecord('x')).toBeUndefined();
  });
});

describe('asString', () => {
  it('returns the value for a string', () => {
    expect(asString('es')).toBe('es');
  });

  it('returns undefined for non-strings', () => {
    expect(asString(42)).toBeUndefined();
    expect(asString(undefined)).toBeUndefined();
  });
});

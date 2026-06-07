import { isRecord } from '../util.ts';

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

export const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION } from './index';

describe('schema', () => {
  it('uses the prototype format version', () => {
    expect(FORMAT_VERSION).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { supportedFormat } from './index';

describe('core', () => {
  it('reads the schema format version', () => {
    expect(supportedFormat()).toBe(0);
  });
});

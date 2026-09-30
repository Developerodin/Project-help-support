import { describe, it, expect } from 'vitest';
import { BRAND_DESCRIPTION, BRAND_FULL, BRAND_SHORT } from '../brand.js';

describe('brand constants', () => {
  it('uses the definitive product name', () => {
    expect(BRAND_FULL).toBe('ProwPlus');
    expect(BRAND_SHORT).toBe('ProwPlus');
    expect(BRAND_DESCRIPTION).toContain('ProwPlus');
  });
});

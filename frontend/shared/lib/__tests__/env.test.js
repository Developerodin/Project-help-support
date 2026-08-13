import { describe, it, expect } from 'vitest';
import { requireEnv } from '../env.js';

describe('requireEnv', () => {
  it('returns the value when it is set', () => {
    expect(requireEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000/v1'))
      .toBe('http://localhost:4000/v1');
  });

  it('strips a trailing slash so joins never double up', () => {
    expect(requireEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000/v1/'))
      .toBe('http://localhost:4000/v1');
  });

  it('THROWS when unset — there is no fallback, by design', () => {
    expect(() => requireEnv('NEXT_PUBLIC_API_URL', undefined)).toThrow(/NEXT_PUBLIC_API_URL/);
  });

  it('throws on an empty or whitespace value too', () => {
    expect(() => requireEnv('NEXT_PUBLIC_API_URL', '')).toThrow();
    expect(() => requireEnv('NEXT_PUBLIC_API_URL', '   ')).toThrow();
  });
});

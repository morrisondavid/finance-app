import { describe, it, expect } from 'vitest';
import { median } from './math.js';

describe('median', () => {
  it('returns 0 for empty input', () => {
    expect(median([])).toBe(0);
  });

  it('returns the single element', () => {
    expect(median([42])).toBe(42);
  });

  it('returns the middle value for odd length', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('returns the mean of the two middle values for even length', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('does not mutate the input array', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

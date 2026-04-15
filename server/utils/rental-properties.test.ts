import { describe, it, expect } from 'vitest';
import { matchRentalProperty } from './rental-properties.js';

describe('matchRentalProperty', () => {
  it('matches Stoneshaw Estates on monzo-joint', () => {
    const result = matchRentalProperty('Stoneshaw Estates', 'monzo-joint', 1292.72);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('78 Hunters Square');
  });

  it('matches Prospect Holdings on monzo-joint', () => {
    const result = matchRentalProperty('Prospect Holdings', 'monzo-joint', 979.2);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('56 Thorney House');
  });

  it('matches even when amount is lower due to agent deductions', () => {
    const result = matchRentalProperty('Stoneshaw Estates', 'monzo-joint', 776.72);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('78 Hunters Square');
  });

  it('returns null for unknown merchant', () => {
    expect(matchRentalProperty('Unknown Agent', 'monzo-joint', 1000)).toBeNull();
  });

  it('returns null for wrong account', () => {
    expect(matchRentalProperty('Stoneshaw Estates', 'natwest', 1292.72)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import {
  isBusinessAccount,
  isCrossAccountBusinessToBusinessTransfer,
} from './types.js';

describe('isBusinessAccount', () => {
  it('returns true for configured business accounts', () => {
    expect(isBusinessAccount('barclays-current')).toBe(true);
    expect(isBusinessAccount('barclays-savings')).toBe(true);
    expect(isBusinessAccount('capital-on-tap')).toBe(true);
    expect(isBusinessAccount('barclaycard')).toBe(true);
  });

  it('returns false for personal accounts', () => {
    expect(isBusinessAccount('natwest')).toBe(false);
    expect(isBusinessAccount('monzo-joint')).toBe(false);
  });

  it('returns false for unknown account ids', () => {
    expect(isBusinessAccount('unknown-bank')).toBe(false);
    expect(isBusinessAccount('')).toBe(false);
  });
});

describe('isCrossAccountBusinessToBusinessTransfer', () => {
  it('returns false when accounts are the same', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'barclays-current')).toBe(
      false,
    );
  });

  it('returns true for business to different business account', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'barclays-savings')).toBe(
      true,
    );
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'capital-on-tap')).toBe(
      true,
    );
  });

  it('returns false for business to personal (director payouts stay expense/income)', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'natwest')).toBe(false);
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'monzo-joint')).toBe(false);
  });

  it('returns false if either account is unknown', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'other')).toBe(false);
    expect(isCrossAccountBusinessToBusinessTransfer('other', 'barclays-current')).toBe(false);
  });
});

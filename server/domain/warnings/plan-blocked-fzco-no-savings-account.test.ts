import { describe, it, expect } from 'vitest';
import { derivePlanBlockedFzcoNoSavingsAccountWarnings } from './plan-blocked-fzco-no-savings-account.js';

describe('derivePlanBlockedFzcoNoSavingsAccountWarnings', () => {
  it('emits one warning per blocked attempt', () => {
    const out = derivePlanBlockedFzcoNoSavingsAccountWarnings({
      recentBlockedAttempts: [
        { attemptKey: 'a1', displayName: 'AED Savings Goal', attemptedAt: '2026-04-25' },
        { attemptKey: 'a2', displayName: 'FZCO Tax Reserve', attemptedAt: '2026-04-26' },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0].code).toBe('plan-blocked-fzco-no-savings-account');
    expect(out[0].severity).toBe('info');
    expect(out[0].context?.displayName).toBe('AED Savings Goal');
  });

  it('emits no warnings when no recent attempts', () => {
    const out = derivePlanBlockedFzcoNoSavingsAccountWarnings({ recentBlockedAttempts: [] });
    expect(out).toEqual([]);
  });
});

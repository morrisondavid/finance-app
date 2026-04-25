import { describe, it, expect } from 'vitest';
import { INCOME_ACTIVITY_CLASS, type IncomeKind } from './activity-class.js';

describe('INCOME_ACTIVITY_CLASS', () => {
  it('classifies every IncomeKind exactly once', () => {
    const expectedKinds: IncomeKind[] = ['contract', 'rental-income', 'recurring-detected'];
    for (const k of expectedKinds) {
      expect(INCOME_ACTIVITY_CLASS[k]).toBeDefined();
    }
  });

  it('treats contracts as active and rentals as passive', () => {
    expect(INCOME_ACTIVITY_CLASS.contract).toBe('active');
    expect(INCOME_ACTIVITY_CLASS['rental-income']).toBe('passive');
    expect(INCOME_ACTIVITY_CLASS['recurring-detected']).toBe('passive');
  });
});

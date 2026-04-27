import { describe, it, expect } from 'vitest';
import { derivePlanBudgetBlownWarnings } from './plan-budget-blown.js';

describe('plan-budget-blown', () => {
  it('does NOT fire when there are no active plans', () => {
    const out = derivePlanBudgetBlownWarnings({
      today: '2026-04-15',
      monthToDateSpend: new Map([['Eating Out', 500]]),
      budgetByCategory: new Map([['Eating Out', 200]]),
      hasActivePlans: false,
    });
    expect(out).toEqual([]);
  });

  it('fires when a budget is exceeded with active plans', () => {
    const out = derivePlanBudgetBlownWarnings({
      today: '2026-04-15',
      monthToDateSpend: new Map([['Eating Out', 500]]),
      budgetByCategory: new Map([['Eating Out', 200]]),
      hasActivePlans: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('plan-budget-blown');
    expect(out[0].context?.overageGbp).toBe(300);
  });

  it('does NOT fire when spend is under cap', () => {
    const out = derivePlanBudgetBlownWarnings({
      today: '2026-04-15',
      monthToDateSpend: new Map([['Eating Out', 100]]),
      budgetByCategory: new Map([['Eating Out', 200]]),
      hasActivePlans: true,
    });
    expect(out).toEqual([]);
  });

  it('severity scales with day-of-month: critical day 1-7', () => {
    const out = derivePlanBudgetBlownWarnings({
      today: '2026-04-05',
      monthToDateSpend: new Map([['Eating Out', 500]]),
      budgetByCategory: new Map([['Eating Out', 200]]),
      hasActivePlans: true,
    });
    expect(out[0].severity).toBe('critical');
    expect(out[0].context?.dayOfMonth).toBe(5);
  });

  it('severity scales: warn day 8-21', () => {
    const out = derivePlanBudgetBlownWarnings({
      today: '2026-04-15',
      monthToDateSpend: new Map([['Eating Out', 500]]),
      budgetByCategory: new Map([['Eating Out', 200]]),
      hasActivePlans: true,
    });
    expect(out[0].severity).toBe('warn');
  });

  it('severity scales: info day 22+', () => {
    const out = derivePlanBudgetBlownWarnings({
      today: '2026-04-25',
      monthToDateSpend: new Map([['Eating Out', 500]]),
      budgetByCategory: new Map([['Eating Out', 200]]),
      hasActivePlans: true,
    });
    expect(out[0].severity).toBe('info');
  });

  it('emits one warning per blown category', () => {
    const out = derivePlanBudgetBlownWarnings({
      today: '2026-04-15',
      monthToDateSpend: new Map([
        ['Eating Out', 500],
        ['Shopping', 800],
        ['Transport', 50], // under cap
      ]),
      budgetByCategory: new Map([
        ['Eating Out', 200],
        ['Shopping', 400],
        ['Transport', 100],
      ]),
      hasActivePlans: true,
    });
    expect(out.map(w => w.context?.category).sort()).toEqual(['Eating Out', 'Shopping']);
  });
});

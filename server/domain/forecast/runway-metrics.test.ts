import { describe, it, expect } from 'vitest';
import {
  mergeAccountSeriesByCurrency,
  mergeHolisticCashPathToGbp,
  firstNegativeBalanceDate,
  runwayMonthsToDate,
} from './runway-metrics.js';
import type { ForecastAccountSeries } from './build-forecast.js';

describe('mergeAccountSeriesByCurrency', () => {
  it('sums same-currency account paths by day', () => {
    const accounts: ForecastAccountSeries[] = [
      {
        account: 'barclays-current',
        currency: 'GBP',
        entityId: 'autonize-it-ltd',
        daily: [
          { date: '2026-01-01', balance: 100 },
          { date: '2026-01-02', balance: 50 },
        ],
      },
      {
        account: 'natwest',
        currency: 'GBP',
        entityId: null,
        daily: [
          { date: '2026-01-01', balance: 20 },
          { date: '2026-01-02', balance: -200 },
        ],
      },
    ];
    const m = mergeAccountSeriesByCurrency(accounts, 'GBP');
    expect(m[0].balance).toBe(120);
    expect(m[1].balance).toBe(-150);
  });

  it('ignores accounts in other currencies (no GBP/AED conflation)', () => {
    const accounts: ForecastAccountSeries[] = [
      {
        account: 'barclays-current',
        currency: 'GBP',
        entityId: 'autonize-it-ltd',
        daily: [{ date: '2026-01-01', balance: 100 }],
      },
      {
        account: 'emirates-islamic',
        currency: 'AED',
        entityId: 'autonize-it-fzco',
        daily: [{ date: '2026-01-01', balance: 5_000 }],
      },
    ];
    expect(mergeAccountSeriesByCurrency(accounts, 'GBP')).toEqual([
      { date: '2026-01-01', balance: 100 },
    ]);
    expect(mergeAccountSeriesByCurrency(accounts, 'AED')).toEqual([
      { date: '2026-01-01', balance: 5_000 },
    ]);
  });
});

describe('mergeHolisticCashPathToGbp', () => {
  it('sums GBP balance plus AED converted to GBP per day (static 0.21 rate)', () => {
    const accounts: ForecastAccountSeries[] = [
      {
        account: 'natwest',
        currency: 'GBP',
        entityId: null,
        daily: [{ date: '2026-01-01', balance: 100 }],
      },
      {
        account: 'emirates-islamic',
        currency: 'AED',
        entityId: 'autonize-it-fzco',
        daily: [{ date: '2026-01-01', balance: 1_000 }],
      },
    ];
    expect(mergeHolisticCashPathToGbp(accounts)).toEqual([
      { date: '2026-01-01', balance: 310 },
    ]);
  });

  it('carries last known balance per currency when only one leg has a new point', () => {
    const accounts: ForecastAccountSeries[] = [
      {
        account: 'natwest',
        currency: 'GBP',
        entityId: null,
        daily: [
          { date: '2026-01-01', balance: 100 },
          { date: '2026-01-02', balance: 90 },
        ],
      },
      {
        account: 'emirates-islamic',
        currency: 'AED',
        entityId: 'autonize-it-fzco',
        daily: [{ date: '2026-01-01', balance: 1_000 }],
      },
    ];
    const m = mergeHolisticCashPathToGbp(accounts);
    expect(m[1]).toEqual({
      date: '2026-01-02',
      balance: 90 + 1_000 * 0.21,
    });
  });
});

describe('firstNegativeBalanceDate', () => {
  it('returns null when never negative', () => {
    expect(
      firstNegativeBalanceDate([{ date: '2026-01-01', balance: 0 }]),
    ).toBeNull();
  });

  it('returns first sub-zero date', () => {
    expect(
      firstNegativeBalanceDate([
        { date: '2026-01-01', balance: 10 },
        { date: '2026-01-02', balance: -0.01 },
      ]),
    ).toBe('2026-01-02');
  });

  it('treats exact zero as still solvent (survival threshold = 0)', () => {
    expect(
      firstNegativeBalanceDate([
        { date: '2026-01-01', balance: 0 },
        { date: '2026-01-02', balance: -0.01 },
      ]),
    ).toBe('2026-01-02');
  });
});

describe('runwayMonthsToDate', () => {
  it('returns null for null stress', () => {
    expect(runwayMonthsToDate('2026-01-01', null)).toBeNull();
  });

  it('returns 0 when stress date is before today', () => {
    expect(runwayMonthsToDate('2026-06-01', '2026-01-01')).toBe(0);
  });

  it('returns ~1 month for ~30 days', () => {
    const months = runwayMonthsToDate('2026-01-01', '2026-01-31');
    expect(months).not.toBeNull();
    expect(months).toBeGreaterThan(0.95);
    expect(months).toBeLessThan(1.05);
  });
});

import { describe, it, expect } from 'vitest';
import { buildForecast } from './build-forecast.js';
import type { ForecastEvent } from './events.js';
import type { AccountStartingBalance } from './build-forecast.js';

const TODAY = '2026-04-25';

function bal(account: string, balance: number, currency = 'GBP' as const, entityId: string | null = 'autonize-it-ltd'): AccountStartingBalance {
  return { account: account as import('../../../shared/api-contracts.js').AccountName, balance, currency, entityId: entityId as import('../../../shared/api-contracts.js').EntityId | null };
}

function ev(date: string, amount: number, account = 'barclays-current', source: ForecastEvent['source'] = 'obligation', label = 'test'): ForecastEvent {
  return { date, amount, account: account as import('../../../shared/api-contracts.js').AccountName, currency: 'GBP', source, label };
}

describe('buildForecast', () => {
  it('returns starting balances on day 0 with no events', () => {
    const result = buildForecast({
      today: TODAY,
      horizonDays: 3,
      startingBalances: [bal('barclays-current', 10000)],
      events: [],
    });

    expect(result.accounts).toHaveLength(1);
    const series = result.accounts[0];
    expect(series.account).toBe('barclays-current');
    expect(series.daily).toHaveLength(4);
    expect(series.daily[0]).toEqual({ date: '2026-04-25', balance: 10000 });
    expect(series.daily[3]).toEqual({ date: '2026-04-28', balance: 10000 });
  });

  it('applies a negative event on the correct day', () => {
    const result = buildForecast({
      today: TODAY,
      horizonDays: 5,
      startingBalances: [bal('barclays-current', 10000)],
      events: [ev('2026-04-27', -3000)],
    });

    const series = result.accounts[0];
    const day26 = series.daily.find(d => d.date === '2026-04-26');
    const day27 = series.daily.find(d => d.date === '2026-04-27');
    expect(day26!.balance).toBe(10000);
    expect(day27!.balance).toBe(7000);
  });

  it('applies a positive event (invoice receipt)', () => {
    const result = buildForecast({
      today: TODAY,
      horizonDays: 5,
      startingBalances: [bal('barclays-current', 5000)],
      events: [ev('2026-04-28', 12000, 'barclays-current', 'invoice-receipt')],
    });

    const series = result.accounts[0];
    const day28 = series.daily.find(d => d.date === '2026-04-28');
    expect(day28!.balance).toBe(17000);
  });

  it('accumulates multiple events on the same day', () => {
    const result = buildForecast({
      today: TODAY,
      horizonDays: 2,
      startingBalances: [bal('barclays-current', 10000)],
      events: [
        ev('2026-04-26', -500, 'barclays-current', 'recurring', 'Netflix'),
        ev('2026-04-26', -1500, 'barclays-current', 'obligation', 'VAT'),
      ],
    });

    const series = result.accounts[0];
    const day26 = series.daily.find(d => d.date === '2026-04-26');
    expect(day26!.balance).toBe(8000);
  });

  it('tracks multiple accounts independently', () => {
    const result = buildForecast({
      today: TODAY,
      horizonDays: 3,
      startingBalances: [
        bal('barclays-current', 10000),
        bal('emirates-islamic', 50000, 'AED', 'autonize-it-fzco'),
      ],
      events: [
        ev('2026-04-26', -2000, 'barclays-current'),
        ev('2026-04-27', 10000, 'emirates-islamic', 'invoice-receipt', 'La Fosse'),
      ],
    });

    expect(result.accounts).toHaveLength(2);
    const gbp = result.accounts.find(a => a.account === 'barclays-current')!;
    const aed = result.accounts.find(a => a.account === 'emirates-islamic')!;

    expect(gbp.daily.find(d => d.date === '2026-04-26')!.balance).toBe(8000);
    expect(aed.daily.find(d => d.date === '2026-04-27')!.balance).toBe(60000);
  });

  it('produces entity summaries with correct snapshots', () => {
    const result = buildForecast({
      today: TODAY,
      horizonDays: 90,
      startingBalances: [
        bal('barclays-current', 20000, 'GBP', 'autonize-it-ltd'),
        bal('emirates-islamic', 50000, 'AED', 'autonize-it-fzco'),
      ],
      events: [
        ev('2026-05-20', -10000, 'barclays-current', 'obligation', 'VAT Q1'),
      ],
    });

    expect(result.entities).toHaveLength(2);
    const ltd = result.entities.find(e => e.entityId === 'autonize-it-ltd')!;
    const fzco = result.entities.find(e => e.entityId === 'autonize-it-fzco')!;

    expect(ltd.current).toBe(20000);
    expect(ltd.day30).toBe(10000);
    expect(ltd.currency).toBe('GBP');

    expect(fzco.current).toBe(50000);
    expect(fzco.day30).toBe(50000);
    expect(fzco.day90).toBe(50000);
    expect(fzco.currency).toBe('AED');
  });

  it('rounds to 2 decimal places', () => {
    const result = buildForecast({
      today: TODAY,
      horizonDays: 1,
      startingBalances: [bal('barclays-current', 100.005)],
      events: [ev('2026-04-25', 0.001)],
    });
    const series = result.accounts[0];
    for (const pt of series.daily) {
      const decimals = pt.balance.toString().split('.')[1];
      expect(!decimals || decimals.length <= 2).toBe(true);
    }
  });

  it('groups personal accounts under entityId null', () => {
    const result = buildForecast({
      today: TODAY,
      horizonDays: 5,
      startingBalances: [
        bal('natwest', 3000, 'GBP', null),
        bal('monzo-joint', 500, 'GBP', null),
      ],
      events: [],
    });

    const personal = result.entities.find(e => e.entityId === null);
    expect(personal).toBeDefined();
    expect(personal!.current).toBe(3500);
    expect(personal!.currency).toBe('GBP');
  });
});

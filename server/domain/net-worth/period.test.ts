import { describe, it, expect } from 'vitest';
import {
  formatIsoWeekPeriodKey,
  isoWeekFromYmd,
  netWorthPeriodInfo,
  resolveNetWorthCadenceFromEnv,
} from './period.js';

describe('netWorthPeriodInfo', () => {
  it('uses ISO week period_key for weekly cadence', () => {
    const info = netWorthPeriodInfo('weekly', '2026-05-06');
    const { isoWeekYear, isoWeekNumber } = isoWeekFromYmd('2026-05-06');
    expect(info.periodKey).toBe(formatIsoWeekPeriodKey(isoWeekYear, isoWeekNumber));
    expect(info.snapshotDate).toBe('2026-05-06');
  });

  it('uses snapshot_date as period_key for daily cadence', () => {
    const info = netWorthPeriodInfo('daily', '2026-01-15');
    expect(info.periodKey).toBe('2026-01-15');
    expect(info.snapshotDate).toBe('2026-01-15');
  });
});

describe('resolveNetWorthCadenceFromEnv', () => {
  const key = 'NET_WORTH_SNAPSHOT_CADENCE';

  it('defaults to weekly', () => {
    const prev = process.env[key];
    delete process.env[key];
    expect(resolveNetWorthCadenceFromEnv()).toBe('weekly');
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  });

  it('accepts daily when set', () => {
    const prev = process.env[key];
    process.env[key] = 'daily';
    expect(resolveNetWorthCadenceFromEnv()).toBe('daily');
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  });
});

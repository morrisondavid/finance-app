/**
 * Pure forecast engine — daily-resolution cash-flow projection.
 *
 * Takes a set of {@link ForecastEvent}s (produced by the collectors)
 * and walks a day-by-day timeline, accumulating running balances per
 * account. Produces per-account daily series, per-entity rollups, and
 * 30/60/90-day snapshots.
 *
 * Pure: no I/O, no registry access, no global state.
 */

import type { AccountName, CurrencyCode, EntityId } from '../../../shared/api-contracts.js';
import { shiftIsoDate } from '../../../shared/iso-date.js';
import type { ForecastEvent } from './events.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AccountStartingBalance {
  readonly account: AccountName;
  readonly balance: number;
  readonly currency: CurrencyCode;
  readonly entityId: EntityId | null;
}

export interface BuildForecastInput {
  readonly today: string;
  readonly horizonDays: number;
  readonly startingBalances: readonly AccountStartingBalance[];
  readonly events: readonly ForecastEvent[];
}

export interface ForecastDailyPoint {
  readonly date: string;
  readonly balance: number;
}

export interface ForecastAccountSeries {
  readonly account: AccountName;
  readonly currency: CurrencyCode;
  readonly entityId: EntityId | null;
  readonly daily: readonly ForecastDailyPoint[];
}

export interface ForecastEntitySummary {
  readonly entityId: EntityId | null;
  readonly currency: CurrencyCode;
  readonly current: number;
  readonly day30: number;
  readonly day60: number;
  readonly day90: number;
}

export interface ForecastResult {
  readonly today: string;
  readonly horizonDays: number;
  readonly accounts: readonly ForecastAccountSeries[];
  readonly entities: readonly ForecastEntitySummary[];
}

// ─── Engine ──────────────────────────────────────────────────────────────────

function groupEventsByDate(events: readonly ForecastEvent[]): Map<string, ForecastEvent[]> {
  const map = new Map<string, ForecastEvent[]>();
  for (const e of events) {
    const bucket = map.get(e.date);
    if (bucket) bucket.push(e);
    else map.set(e.date, [e]);
  }
  return map;
}

function snapshotBalance(
  daily: readonly ForecastDailyPoint[],
  targetDate: string,
): number {
  if (daily.length === 0) return 0;
  let last = daily[0].balance;
  for (const pt of daily) {
    if (pt.date > targetDate) break;
    last = pt.balance;
  }
  return last;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildForecast(input: BuildForecastInput): ForecastResult {
  const { today, horizonDays, startingBalances, events } = input;
  const horizonEnd = shiftIsoDate(today, horizonDays);

  const balances = new Map<AccountName, number>();
  const meta = new Map<AccountName, { currency: CurrencyCode; entityId: EntityId | null }>();
  for (const sb of startingBalances) {
    balances.set(sb.account, sb.balance);
    meta.set(sb.account, { currency: sb.currency, entityId: sb.entityId });
  }

  const eventsByDate = groupEventsByDate(events);

  const dailyByAccount = new Map<AccountName, ForecastDailyPoint[]>();
  for (const sb of startingBalances) {
    dailyByAccount.set(sb.account, []);
  }

  let cursor = today;
  while (cursor <= horizonEnd) {
    const dayEvents = eventsByDate.get(cursor);
    if (dayEvents) {
      for (const ev of dayEvents) {
        const current = balances.get(ev.account) ?? 0;
        balances.set(ev.account, round2(current + ev.amount));
        if (!meta.has(ev.account)) {
          meta.set(ev.account, { currency: ev.currency, entityId: null });
        }
      }
    }

    for (const [account, balance] of balances) {
      let series = dailyByAccount.get(account);
      if (!series) {
        series = [];
        dailyByAccount.set(account, series);
      }
      series.push({ date: cursor, balance: round2(balance) });
    }

    cursor = shiftIsoDate(cursor, 1);
  }

  const accounts: ForecastAccountSeries[] = [];
  for (const [account, daily] of dailyByAccount) {
    const m = meta.get(account);
    accounts.push({
      account,
      currency: m?.currency ?? 'GBP',
      entityId: m?.entityId ?? null,
      daily,
    });
  }

  const day30 = shiftIsoDate(today, 30);
  const day60 = shiftIsoDate(today, 60);
  const day90 = shiftIsoDate(today, 90);

  const entityMap = new Map<string, {
    entityId: EntityId | null;
    currency: CurrencyCode;
    current: number;
    day30: number;
    day60: number;
    day90: number;
  }>();

  for (const series of accounts) {
    const key = `${series.entityId ?? 'personal'}:${series.currency}`;
    const existing = entityMap.get(key);
    const cur = series.daily.length > 0 ? series.daily[0].balance : 0;
    const d30 = snapshotBalance(series.daily, day30);
    const d60 = snapshotBalance(series.daily, day60);
    const d90 = snapshotBalance(series.daily, day90);

    if (existing) {
      existing.current = round2(existing.current + cur);
      existing.day30 = round2(existing.day30 + d30);
      existing.day60 = round2(existing.day60 + d60);
      existing.day90 = round2(existing.day90 + d90);
    } else {
      entityMap.set(key, {
        entityId: series.entityId,
        currency: series.currency,
        current: cur,
        day30: d30,
        day60: d60,
        day90: d90,
      });
    }
  }

  const entities: ForecastEntitySummary[] = [...entityMap.values()];

  return { today, horizonDays, accounts, entities };
}

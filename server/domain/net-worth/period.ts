/**
 * Period keys for net-worth snapshots (ISO week vs calendar day).
 */

import { todayIsoLocal } from '../../../shared/iso-date.js';
import type { NetWorthSnapshotCadence } from '../../db/net-worth-csv.js';

export interface NetWorthPeriodInfo {
  readonly snapshotDate: string;
  readonly periodKey: string;
  readonly isoWeekYear: number;
  readonly isoWeekNumber: number;
}

/**
 * ISO 8601 week: Monday is first day of week; week 1 contains Jan 4.
 * Uses local calendar components of `ymd` (same basis as {@link todayIsoLocal}).
 */
export function isoWeekFromYmd(ymd: string): { isoWeekYear: number; isoWeekNumber: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const jan4 = new Date(target.getFullYear(), 0, 4, 12, 0, 0, 0);
  const week1Thursday = new Date(jan4.valueOf());
  const dayNrJan4 = (jan4.getDay() + 6) % 7;
  week1Thursday.setDate(jan4.getDate() - dayNrJan4 + 3);
  const week = Math.round((target.getTime() - week1Thursday.getTime()) / 86_400_000 / 7) + 1;
  const isoWeekYear = target.getFullYear();
  return { isoWeekYear, isoWeekNumber: week };
}

export function formatIsoWeekPeriodKey(isoWeekYear: number, isoWeekNumber: number): string {
  return `${String(isoWeekYear)}-W${String(isoWeekNumber).padStart(2, '0')}`;
}

export function netWorthPeriodInfo(
  cadence: NetWorthSnapshotCadence,
  snapshotDate: string = todayIsoLocal(),
): NetWorthPeriodInfo {
  if (cadence === 'daily') {
    return {
      snapshotDate,
      periodKey: snapshotDate,
      isoWeekYear: isoWeekFromYmd(snapshotDate).isoWeekYear,
      isoWeekNumber: isoWeekFromYmd(snapshotDate).isoWeekNumber,
    };
  }
  const { isoWeekYear, isoWeekNumber } = isoWeekFromYmd(snapshotDate);
  return {
    snapshotDate,
    periodKey: formatIsoWeekPeriodKey(isoWeekYear, isoWeekNumber),
    isoWeekYear,
    isoWeekNumber,
  };
}

export function resolveNetWorthCadenceFromEnv(): NetWorthSnapshotCadence {
  const raw = process.env.NET_WORTH_SNAPSHOT_CADENCE?.trim().toLowerCase();
  if (raw === 'daily') return 'daily';
  return 'weekly';
}

/**
 * §3.1 Net worth snapshots — build rows from liquidity, 12-month commitments, and debts.
 */

import type { Company, EntityId } from '../../../shared/api-contracts.js';
import { isoDateAddCalendarMonths, shiftIsoDate, todayIsoLocal } from '../../../shared/iso-date.js';
import { NET_WORTH_DIR } from '../../db/connection.js';
import {
  type NetWorthSnapshotCadence,
  type NetWorthSnapshotCsvRow,
  type NetWorthSnapshotEntityId,
  ensureNetWorthSnapshotsCsvWithHeader,
  getNetWorthSnapshotsCsvPath,
  readNetWorthSnapshotsFromCsvFile,
  rowDiskKey,
  writeNetWorthSnapshotsToCsvFile,
} from '../../db/net-worth-csv.js';
import { getAllAccountBalances } from '../../db/repositories/balance.js';
import { getAllDebtSummaries, getDebtSummary, listDebts } from '../../db/repositories/debts.js';
import { getAllObligations, toApiObligation } from '../../db/repositories/obligations.js';
import { round2 } from '../../utils/math.js';
import { buildLiquidityCommitments, obligationRemainingGbpForRow } from '../accounts/liquidity-commitments.js';
import { buildLiquidityOverview } from '../accounts/liquidity-overview.js';
import { pickBalances } from '../accounts/pick-balances.js';
import { accountsForEntity } from '../accounts/queries.js';
import { allEntityIds, companyById } from '../company/index.js';
import { netWorthPeriodInfo, resolveNetWorthCadenceFromEnv } from './period.js';

/** Documented in ROADMAP §3.1 — changing this bumps historical interpretation. */
export const NET_WORTH_FORMULA_VERSION = '1.0.0';

export interface CaptureNetWorthSnapshotsOpts {
  readonly force?: boolean;
  /** Override "today" for tests */
  readonly snapshotDate?: string;
}

export interface NetWorthCaptureResult {
  readonly skipped: boolean;
  readonly reason?: string;
  readonly periodKey: string;
  readonly snapshotDate: string;
  readonly cadence: NetWorthSnapshotCadence;
  readonly rowsWritten: number;
}

function obligationMatchesCompany(obEntity: string, company: Company): boolean {
  const n = obEntity.trim().toLowerCase();
  if (n.length === 0) return false;
  const trade = company.trading_name.trim().toLowerCase();
  const legal = company.legal_name.trim().toLowerCase();
  return n.includes(trade) || trade.includes(n) || n.includes(legal) || legal.includes(n);
}

function sumAttributedObligationsGbp(eid: EntityId, todayIso: string): number {
  const company = companyById(eid);
  if (company === null) return 0;
  const horizonEnd = isoDateAddCalendarMonths(todayIso, 12);
  const overdueLookback = shiftIsoDate(todayIso, -365);
  const dbRows = getAllObligations({
    minDueDate: overdueLookback,
    maxDueDate: horizonEnd,
    hideCompleted: true,
  });
  let sum = 0;
  for (const row of dbRows) {
    if (!obligationMatchesCompany(row.entity, company)) continue;
    const ob = toApiObligation(row);
    sum += obligationRemainingGbpForRow(ob);
  }
  return round2(sum);
}

function debtTotalGbpForEntity(eid: EntityId): number {
  const allowed = new Set(accountsForEntity(eid));
  const debts = listDebts({ includeArchived: false });
  let sum = 0;
  for (const d of debts) {
    if (d.sourceAccounts.length === 0) continue;
    const allInEntity = d.sourceAccounts.every(a => allowed.has(a));
    if (!allInEntity) continue;
    sum += getDebtSummary(d).currentBalance;
  }
  return round2(sum);
}

function computeNetGbp(cash: number, credit: number, obligations: number, debt: number): number {
  return round2(cash + credit - obligations - debt);
}

export function buildNetWorthSnapshotRows(opts: {
  readonly snapshotDate: string;
  readonly cadence: NetWorthSnapshotCadence;
  readonly capturedAt: string;
}): NetWorthSnapshotCsvRow[] {
  const todayIso = opts.snapshotDate;
  const { periodKey } = netWorthPeriodInfo(opts.cadence, todayIso);
  const allBalances = getAllAccountBalances();

  const globalLiq = buildLiquidityOverview(allBalances);
  const globalLc = buildLiquidityCommitments({
    todayIso,
    totalCashGbp: globalLiq.totalCashGbp,
  });
  const globalDebt = getAllDebtSummaries({ includeArchived: false }).totalOutstanding;
  const globalNet = computeNetGbp(
    globalLiq.totalCashGbp,
    globalLiq.totalCreditGbp,
    globalLc.totalCommittedGbp,
    globalDebt,
  );

  const rows: NetWorthSnapshotCsvRow[] = [
    {
      periodKey,
      snapshotDate: todayIso,
      entityId: 'global',
      reportingCurrency: 'GBP',
      cadence: opts.cadence,
      totalCashGbp: globalLiq.totalCashGbp,
      totalCreditGbp: globalLiq.totalCreditGbp,
      totalObligations12mGbp: globalLc.totalCommittedGbp,
      totalDebtGbp: globalDebt,
      netGbp: globalNet,
      formulaVersion: NET_WORTH_FORMULA_VERSION,
      capturedAt: opts.capturedAt,
    },
  ];

  for (const eid of allEntityIds()) {
    const entAccounts = accountsForEntity(eid);
    const subBalances = pickBalances(allBalances, [...entAccounts]);
    const entLiq = buildLiquidityOverview(subBalances);
    const obSum = sumAttributedObligationsGbp(eid, todayIso);
    const debtEnt = debtTotalGbpForEntity(eid);
    const entNet = computeNetGbp(entLiq.totalCashGbp, entLiq.totalCreditGbp, obSum, debtEnt);
    rows.push({
      periodKey,
      snapshotDate: todayIso,
      entityId: eid,
      reportingCurrency: 'GBP',
      cadence: opts.cadence,
      totalCashGbp: entLiq.totalCashGbp,
      totalCreditGbp: entLiq.totalCreditGbp,
      totalObligations12mGbp: obSum,
      totalDebtGbp: debtEnt,
      netGbp: entNet,
      formulaVersion: NET_WORTH_FORMULA_VERSION,
      capturedAt: opts.capturedAt,
    });
  }

  return rows;
}

function expectedEntityIds(): NetWorthSnapshotEntityId[] {
  return ['global', ...allEntityIds()];
}

export function captureNetWorthSnapshots(opts: CaptureNetWorthSnapshotsOpts = {}): NetWorthCaptureResult {
  const cadence = resolveNetWorthCadenceFromEnv();
  const snapshotDate = opts.snapshotDate ?? todayIsoLocal();
  const period = netWorthPeriodInfo(cadence, snapshotDate);
  ensureNetWorthSnapshotsCsvWithHeader(NET_WORTH_DIR);
  const csvPath = getNetWorthSnapshotsCsvPath(NET_WORTH_DIR);
  const existing = readNetWorthSnapshotsFromCsvFile(csvPath);

  if (!opts.force) {
    const keysForPeriod = new Set(
      existing
        .filter(r => r.periodKey === period.periodKey && r.cadence === cadence)
        .map(r => rowDiskKey(r)),
    );
    const expected = expectedEntityIds().map(eid => `${period.periodKey}\t${eid}\tGBP`);
    const allPresent = expected.every(k => keysForPeriod.has(k));
    if (allPresent && keysForPeriod.size >= expected.length) {
      return {
        skipped: true,
        reason: 'period-already-captured',
        periodKey: period.periodKey,
        snapshotDate,
        cadence,
        rowsWritten: 0,
      };
    }
  }

  const capturedAt = new Date().toISOString();
  const freshRows = buildNetWorthSnapshotRows({ snapshotDate, cadence, capturedAt });
  const byKey = new Map<string, NetWorthSnapshotCsvRow>();
  for (const r of existing) {
    byKey.set(rowDiskKey(r), r);
  }
  for (const r of freshRows) {
    byKey.set(rowDiskKey(r), r);
  }
  writeNetWorthSnapshotsToCsvFile(csvPath, [...byKey.values()]);

  return {
    skipped: false,
    periodKey: period.periodKey,
    snapshotDate,
    cadence,
    rowsWritten: freshRows.length,
  };
}

export function maybeCaptureNetWorthSnapshots(): NetWorthCaptureResult {
  return captureNetWorthSnapshots({ force: false });
}

export function listNetWorthSnapshotsFromDisk(): readonly NetWorthSnapshotCsvRow[] {
  ensureNetWorthSnapshotsCsvWithHeader(NET_WORTH_DIR);
  return readNetWorthSnapshotsFromCsvFile(getNetWorthSnapshotsCsvPath(NET_WORTH_DIR));
}

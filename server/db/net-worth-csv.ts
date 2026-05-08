/**
 * Canonical net-worth snapshots CSV (§3.1). Source of truth on disk; no hosted DB.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import type { EntityId } from '../../shared/api-contracts.js';
import { EntityIdSchema } from '../../shared/api-contracts.js';
import { round2 } from '../utils/math.js';
import { escapeCsvField, atomicWriteCsv, ensureDir } from '../utils/csv-helpers.js';

export const NET_WORTH_SNAPSHOTS_CSV_FILENAME = 'net-worth-snapshots.csv';

export type NetWorthSnapshotEntityId = 'global' | EntityId;

export type NetWorthSnapshotCadence = 'weekly' | 'daily';

export interface NetWorthSnapshotCsvRow {
  readonly periodKey: string;
  readonly snapshotDate: string;
  readonly entityId: NetWorthSnapshotEntityId;
  readonly reportingCurrency: 'GBP';
  readonly cadence: NetWorthSnapshotCadence;
  readonly totalCashGbp: number;
  readonly totalCreditGbp: number;
  /** Rolling 12-month committed outflows (global) or attributed obligation remainder (entity). */
  readonly totalObligations12mGbp: number;
  readonly totalDebtGbp: number;
  readonly netGbp: number;
  readonly formulaVersion: string;
  readonly capturedAt: string;
}

const HEADERS = [
  'period_key',
  'snapshot_date',
  'entity_id',
  'reporting_currency',
  'cadence',
  'total_cash_gbp',
  'total_credit_gbp',
  'total_obligations_12m_gbp',
  'total_debt_gbp',
  'net_gbp',
  'formula_version',
  'captured_at',
] as const;

export function getNetWorthSnapshotsCsvPath(dir: string): string {
  return path.join(dir, NET_WORTH_SNAPSHOTS_CSV_FILENAME);
}

export function ensureNetWorthSnapshotsCsvWithHeader(dir: string): void {
  ensureDir(dir);
  const p = getNetWorthSnapshotsCsvPath(dir);
  if (!fs.existsSync(p)) {
    atomicWriteCsv(p, `${HEADERS.join(',')}\n`);
  }
}

function parseEntityId(raw: string): NetWorthSnapshotEntityId | null {
  const t = raw.trim();
  if (t === 'global') return 'global';
  const p = EntityIdSchema.safeParse(t);
  return p.success ? p.data : null;
}

export function readNetWorthSnapshotsFromCsvFile(csvPath: string): NetWorthSnapshotCsvRow[] {
  if (!fs.existsSync(csvPath)) {
    return [];
  }
  const content = fs.readFileSync(csvPath, 'utf8').trim();
  if (content === '') {
    return [];
  }
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: NetWorthSnapshotCsvRow[] = [];

  for (const row of records) {
    const entityId = row.entity_id !== undefined ? parseEntityId(row.entity_id) : null;
    const cadence = row.cadence === 'daily' ? 'daily' : 'weekly';
    const currency = row.reporting_currency === 'GBP' ? 'GBP' : null;
    if (
      entityId === null ||
      currency === null ||
      !row.period_key ||
      !row.snapshot_date ||
      row.total_cash_gbp === undefined ||
      row.total_credit_gbp === undefined ||
      row.total_obligations_12m_gbp === undefined ||
      row.total_debt_gbp === undefined ||
      row.net_gbp === undefined ||
      !row.formula_version ||
      !row.captured_at
    ) {
      continue;
    }
    rows.push({
      periodKey: row.period_key,
      snapshotDate: row.snapshot_date,
      entityId,
      reportingCurrency: 'GBP',
      cadence,
      totalCashGbp: Number(row.total_cash_gbp),
      totalCreditGbp: Number(row.total_credit_gbp),
      totalObligations12mGbp: Number(row.total_obligations_12m_gbp),
      totalDebtGbp: Number(row.total_debt_gbp),
      netGbp: Number(row.net_gbp),
      formulaVersion: row.formula_version,
      capturedAt: row.captured_at,
    });
  }

  return rows;
}

export function writeNetWorthSnapshotsToCsvFile(csvPath: string, rows: readonly NetWorthSnapshotCsvRow[]): void {
  const sorted = [...rows].sort((a, b) => {
    const pk = a.periodKey.localeCompare(b.periodKey);
    if (pk !== 0) return pk;
    const e = a.entityId.localeCompare(b.entityId);
    if (e !== 0) return e;
    return a.reportingCurrency.localeCompare(b.reportingCurrency);
  });

  const lines = [HEADERS.join(',')];
  for (const r of sorted) {
    lines.push(
      [
        escapeCsvField(r.periodKey),
        escapeCsvField(r.snapshotDate),
        escapeCsvField(r.entityId),
        r.reportingCurrency,
        r.cadence,
        String(round2(r.totalCashGbp)),
        String(round2(r.totalCreditGbp)),
        String(round2(r.totalObligations12mGbp)),
        String(round2(r.totalDebtGbp)),
        String(round2(r.netGbp)),
        escapeCsvField(r.formulaVersion),
        escapeCsvField(r.capturedAt),
      ].join(','),
    );
  }
  atomicWriteCsv(csvPath, `${lines.join('\n')}\n`);
}

export function rowDiskKey(r: Pick<NetWorthSnapshotCsvRow, 'periodKey' | 'entityId' | 'reportingCurrency'>): string {
  return `${r.periodKey}\t${r.entityId}\t${r.reportingCurrency}`;
}

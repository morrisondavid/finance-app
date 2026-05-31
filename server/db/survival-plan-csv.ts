/**
 * CSV source of truth for the committed survival daily allowance plan.
 * Pattern mirrors `budgets-csv.ts` / `opening-balances-csv.ts`.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { BUDGETS_DIR } from './connection.js';
import { escapeCsvField, atomicWriteCsv } from '../utils/csv-helpers.js';
import { recomputeAndPersistDataManifest } from '../data-manifest.js';
import { uploadDurableRelPathsToS3 } from '../storage/s3-durable-sync.js';

export const SURVIVAL_PLAN_CSV_FILENAME = 'survival-plan.csv';

export type SurvivalPlanScope = 'personal' | 'household';

export interface SurvivalPlanRow {
  readonly startDate: string;
  readonly dailyAmount: number;
  readonly scope: SurvivalPlanScope;
  readonly currency: 'GBP';
  readonly note: string;
  readonly active: boolean;
}

const HEADERS = ['start_date', 'daily_amount', 'scope', 'currency', 'note', 'active'] as const;

export function getSurvivalPlanCsvPath(budgetsDir: string = BUDGETS_DIR): string {
  return path.join(budgetsDir, SURVIVAL_PLAN_CSV_FILENAME);
}

function parseActive(raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return true;
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function parseScope(raw: string | undefined): SurvivalPlanScope {
  const v = (raw ?? 'personal').trim().toLowerCase();
  return v === 'household' ? 'household' : 'personal';
}

export function readSurvivalPlanFromCsvFile(csvPath: string): SurvivalPlanRow[] {
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf8').trim();
  if (content === '') return [];

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: SurvivalPlanRow[] = [];
  for (const row of records) {
    const startDate = row.start_date?.trim();
    const dailyRaw = row.daily_amount?.trim();
    if (!startDate || !dailyRaw) continue;
    const dailyAmount = Number(dailyRaw);
    if (!Number.isFinite(dailyAmount) || dailyAmount < 0) continue;
    rows.push({
      startDate,
      dailyAmount,
      scope: parseScope(row.scope),
      currency: 'GBP',
      note: row.note?.trim() ?? '',
      active: parseActive(row.active),
    });
  }
  return rows;
}

export function getActiveSurvivalPlan(csvPath: string = getSurvivalPlanCsvPath()): SurvivalPlanRow | null {
  const active = readSurvivalPlanFromCsvFile(csvPath).filter(r => r.active);
  if (active.length === 0) return null;
  return active[active.length - 1];
}

export function writeSurvivalPlanCsvFile(csvPath: string, row: SurvivalPlanRow): void {
  const lines = [
    HEADERS.join(','),
    [
      escapeCsvField(row.startDate),
      String(row.dailyAmount),
      row.scope,
      row.currency,
      escapeCsvField(row.note),
      row.active ? 'true' : 'false',
    ].join(','),
  ];
  atomicWriteCsv(csvPath, lines.join('\n') + '\n');
}

export function persistSurvivalPlan(row: SurvivalPlanRow, csvPath: string = getSurvivalPlanCsvPath()): void {
  writeSurvivalPlanCsvFile(csvPath, row);
  recomputeAndPersistDataManifest();
  void uploadDurableRelPathsToS3(['budgets/survival-plan.csv', 'data/manifest.json'], 'survival-plan');
}

export function clearSurvivalPlan(csvPath: string = getSurvivalPlanCsvPath()): void {
  if (fs.existsSync(csvPath)) {
    fs.unlinkSync(csvPath);
  }
  recomputeAndPersistDataManifest();
}

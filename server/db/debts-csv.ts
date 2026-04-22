/**
 * Canonical debts CSV on disk (source of truth). DB is populated on startup;
 * mutating APIs rewrite this file. Debts are external creditors we don't have
 * statement feeds for, matched against our real-account transactions by
 * merchant substring.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import type { AccountName } from '../types.js';
import { isValidAccountName } from '../domain/accounts/index.js';
import { round2 } from '../utils/math.js';
import { escapeCsvField, atomicWriteCsv } from '../utils/csv-helpers.js';

export const DEBTS_CSV_FILENAME = 'debts.csv';

export type DebtKind = 'consumer' | 'mortgage';
export type RepaymentType = 'repayment' | 'interest-only';

export interface DebtCsvRow {
  id: string;
  name: string;
  merchantPattern: string;
  sourceAccounts: readonly AccountName[];
  originalLoanAmount: number;
  originalLoanDate: string | null;
  openingBalance: number;
  openingBalanceDate: string;
  archived: boolean;
  /**
   * Payment amounts used to disambiguate debts that share the same merchant
   * pattern (e.g. two Barclays Partner Finance loans, or two NatWest mortgages
   * whose amounts changed at renewal). When non-empty, the transaction matcher
   * filters by `ROUND(ABS(amount), 2) IN (...)`. Empty array = no amount
   * filter.
   */
  matchAmounts: readonly number[];
  kind: DebtKind;
  interestRate: number | null;
  fixedRateEndDate: string | null;
  repaymentType: RepaymentType | null;
  propertyValueEstimate: number | null;
  propertyId: string | null;
}

const HEADERS = [
  'id',
  'name',
  'merchant_pattern',
  'source_accounts',
  'original_loan_amount',
  'original_loan_date',
  'opening_balance',
  'opening_balance_date',
  'archived',
  'match_amounts',
  'kind',
  'interest_rate',
  'fixed_rate_end_date',
  'repayment_type',
  'property_value_estimate',
  'property_id',
] as const;

/**
 * First-boot defaults. Written only when `debts/debts.csv` is missing.
 * User edits via the UI (or hand-edits) are never overwritten.
 */
/** Shared defaults for consumer debts — mortgage fields null. */
const CONSUMER_DEFAULTS = {
  kind: 'consumer' as const,
  interestRate: null,
  fixedRateEndDate: null,
  repaymentType: null,
  propertyValueEstimate: null,
  propertyId: null,
};

export const DEFAULT_DEBT_ROWS: readonly DebtCsvRow[] = [
  {
    id: 'funding-circle',
    name: 'Funding Circle',
    merchantPattern: 'FUNDING CIRCLE',
    sourceAccounts: ['barclays-current'],
    originalLoanAmount: 18700.0,
    originalLoanDate: '2023-11-09',
    openingBalance: 13138.71,
    openingBalanceDate: '2026-04-19',
    archived: false,
    matchAmounts: [],
    ...CONSUMER_DEFAULTS,
  },
  {
    id: 'bounce-back-loan',
    name: 'Bounce Back Loan',
    merchantPattern: '0520A',
    sourceAccounts: ['barclays-current'],
    originalLoanAmount: 50000.0,
    originalLoanDate: null,
    openingBalance: 22685.36,
    openingBalanceDate: '2026-04-19',
    archived: false,
    matchAmounts: [],
    ...CONSUMER_DEFAULTS,
  },
  {
    id: 'novuna',
    name: 'Novuna Finance',
    merchantPattern: 'NOVUNA',
    sourceAccounts: ['natwest'],
    originalLoanAmount: 13228.0,
    originalLoanDate: null,
    openingBalance: 5518.23,
    openingBalanceDate: '2026-04-19',
    archived: false,
    matchAmounts: [],
    ...CONSUMER_DEFAULTS,
  },
  {
    id: 'bathroom-loan-a',
    name: 'Bathroom Loan (A)',
    merchantPattern: 'Barclays Partner Finance',
    sourceAccounts: ['monzo-joint'],
    originalLoanAmount: 9191.26,
    originalLoanDate: null,
    openingBalance: 3850.2,
    openingBalanceDate: '2026-04-19',
    archived: false,
    matchAmounts: [232.22],
    ...CONSUMER_DEFAULTS,
  },
  {
    id: 'bathroom-loan-b',
    name: 'Bathroom Loan (B)',
    merchantPattern: 'Barclays Partner Finance',
    sourceAccounts: ['monzo-joint'],
    originalLoanAmount: 7917.04,
    originalLoanDate: null,
    openingBalance: 3678.52,
    openingBalanceDate: '2026-04-19',
    archived: false,
    matchAmounts: [192.66],
    ...CONSUMER_DEFAULTS,
  },
  {
    id: 'mortgage-heath-park-road',
    name: '53 Heath Park Road Mortgage',
    merchantPattern: 'Coventry Building',
    sourceAccounts: ['monzo-joint'],
    originalLoanAmount: 449000,
    originalLoanDate: null,
    openingBalance: 428117,
    openingBalanceDate: '2024-03-14',
    archived: false,
    matchAmounts: [2221.63, 3431.96],
    kind: 'mortgage',
    interestRate: 4.4,
    fixedRateEndDate: '2029-06-30',
    repaymentType: 'repayment',
    propertyValueEstimate: 630000,
    propertyId: 'heath-park-road-53',
  },
  {
    id: 'mortgage-hunters-square',
    name: '78 Hunters Square Mortgage',
    merchantPattern: 'NatWest',
    sourceAccounts: ['monzo-joint'],
    originalLoanAmount: 214757.15,
    originalLoanDate: null,
    openingBalance: 214757.15,
    openingBalanceDate: '2021-11-30',
    archived: false,
    matchAmounts: [801.35, 1054.64, 306.35],
    kind: 'mortgage',
    interestRate: 4.48,
    fixedRateEndDate: '2028-04-30',
    repaymentType: 'interest-only',
    propertyValueEstimate: 315553.21,
    propertyId: 'hunters-square-78',
  },
  {
    id: 'mortgage-thorney-house',
    name: '56 Thorney House Mortgage',
    merchantPattern: 'NatWest',
    sourceAccounts: ['monzo-joint'],
    originalLoanAmount: 121785.99,
    originalLoanDate: null,
    openingBalance: 121785.99,
    openingBalanceDate: '2021-11-30',
    archived: false,
    matchAmounts: [683.38, 630.99, 174.44],
    kind: 'mortgage',
    interestRate: 6.74,
    fixedRateEndDate: null,
    repaymentType: 'interest-only',
    propertyValueEstimate: 188085.56,
    propertyId: 'thorney-house-56',
  },
] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function getDebtsCsvPath(debtsDir: string): string {
  return path.join(debtsDir, DEBTS_CSV_FILENAME);
}

function parseSourceAccounts(raw: string): AccountName[] | null {
  const tokens = raw
    .split(';')
    .map(t => t.trim())
    .filter(t => t.length > 0);
  if (tokens.length === 0) return null;
  const out: AccountName[] = [];
  for (const t of tokens) {
    if (!isValidAccountName(t)) return null;
    out.push(t);
  }
  return out;
}

function serializeSourceAccounts(accounts: readonly AccountName[]): string {
  return accounts.join(';');
}

/**
 * Read and parse debts CSV. Missing file returns [].
 * Invalid rows are skipped (with a console warning) rather than aborting the load.
 * Duplicate ids: last row wins (matches budgets-csv behaviour).
 */
export function readDebtsFromCsvFile(csvPath: string): DebtCsvRow[] {
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

  const merged = new Map<string, DebtCsvRow>();

  for (const row of records) {
    const id = (row.id ?? '').trim();
    const name = (row.name ?? '').trim();
    const merchantPattern = (row.merchant_pattern ?? '').trim();
    const sourceAccountsRaw = (row.source_accounts ?? '').trim();
    const originalLoanAmountRaw = (row.original_loan_amount ?? '').trim();
    const originalLoanDateRaw = (row.original_loan_date ?? '').trim();
    const openingBalanceRaw = (row.opening_balance ?? '').trim();
    const openingBalanceDateRaw = (row.opening_balance_date ?? '').trim();
    const archivedRaw = (row.archived ?? '').trim().toLowerCase();
    const matchAmountsRaw = (row.match_amounts ?? row.match_amount ?? '').trim();
    const kindRaw = (row.kind ?? '').trim().toLowerCase();
    const interestRateRaw = (row.interest_rate ?? '').trim();
    const fixedRateEndDateRaw = (row.fixed_rate_end_date ?? '').trim();
    const repaymentTypeRaw = (row.repayment_type ?? '').trim().toLowerCase();
    const propertyValueEstimateRaw = (row.property_value_estimate ?? '').trim();
    const propertyIdRaw = (row.property_id ?? '').trim();

    if (!id || !name || !merchantPattern) {
      console.warn(`[debts-csv] Dropping row with missing id/name/pattern: ${JSON.stringify(row)}`);
      continue;
    }

    const sourceAccounts = parseSourceAccounts(sourceAccountsRaw);
    if (!sourceAccounts) {
      console.warn(`[debts-csv] Dropping row ${id} with invalid source_accounts: "${sourceAccountsRaw}"`);
      continue;
    }

    const originalLoanAmount = Number(originalLoanAmountRaw);
    if (!Number.isFinite(originalLoanAmount) || originalLoanAmount <= 0) {
      console.warn(`[debts-csv] Dropping row ${id} with invalid original_loan_amount: "${originalLoanAmountRaw}"`);
      continue;
    }

    const openingBalance = Number(openingBalanceRaw);
    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
      console.warn(`[debts-csv] Dropping row ${id} with invalid opening_balance: "${openingBalanceRaw}"`);
      continue;
    }

    if (!ISO_DATE_RE.test(openingBalanceDateRaw)) {
      console.warn(`[debts-csv] Dropping row ${id} with invalid opening_balance_date: "${openingBalanceDateRaw}"`);
      continue;
    }

    const originalLoanDate =
      originalLoanDateRaw === ''
        ? null
        : ISO_DATE_RE.test(originalLoanDateRaw)
          ? originalLoanDateRaw
          : null;
    if (originalLoanDateRaw !== '' && originalLoanDate === null) {
      console.warn(`[debts-csv] Row ${id} had invalid original_loan_date "${originalLoanDateRaw}"; storing as null`);
    }

    const archived = archivedRaw === 'true' || archivedRaw === '1' || archivedRaw === 'yes';

    let matchAmounts: number[] = [];
    if (matchAmountsRaw !== '') {
      const tokens = matchAmountsRaw.split(';').map(t => t.trim()).filter(t => t.length > 0);
      let valid = true;
      for (const tok of tokens) {
        const parsed = Number(tok);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          console.warn(`[debts-csv] Dropping row ${id} with invalid match_amounts value: "${tok}"`);
          valid = false;
          break;
        }
        matchAmounts.push(round2(parsed));
      }
      if (!valid) continue;
    }

    const kind: DebtKind = kindRaw === 'mortgage' ? 'mortgage' : 'consumer';

    let interestRate: number | null = null;
    if (interestRateRaw !== '') {
      const parsed = Number(interestRateRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.warn(`[debts-csv] Dropping row ${id} with invalid interest_rate: "${interestRateRaw}"`);
        continue;
      }
      interestRate = round2(parsed);
    }

    const fixedRateEndDate: string | null =
      fixedRateEndDateRaw !== '' && ISO_DATE_RE.test(fixedRateEndDateRaw)
        ? fixedRateEndDateRaw
        : null;
    if (fixedRateEndDateRaw !== '' && fixedRateEndDate === null) {
      console.warn(`[debts-csv] Row ${id} had invalid fixed_rate_end_date "${fixedRateEndDateRaw}"; storing as null`);
    }

    const repaymentType: RepaymentType | null =
      repaymentTypeRaw === 'repayment' || repaymentTypeRaw === 'interest-only'
        ? repaymentTypeRaw
        : null;

    let propertyValueEstimate: number | null = null;
    if (propertyValueEstimateRaw !== '') {
      const parsed = Number(propertyValueEstimateRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.warn(`[debts-csv] Dropping row ${id} with invalid property_value_estimate: "${propertyValueEstimateRaw}"`);
        continue;
      }
      propertyValueEstimate = round2(parsed);
    }

    const propertyId: string | null = propertyIdRaw !== '' ? propertyIdRaw : null;

    merged.set(id, {
      id,
      name,
      merchantPattern,
      sourceAccounts,
      originalLoanAmount,
      originalLoanDate,
      openingBalance,
      openingBalanceDate: openingBalanceDateRaw,
      archived,
      matchAmounts,
      kind,
      interestRate,
      fixedRateEndDate,
      repaymentType,
      propertyValueEstimate,
      propertyId,
    });
  }

  return Array.from(merged.values());
}

/**
 * Write debts to CSV atomically (temp file + rename). Rows are sorted by id
 * for stable diffs.
 */
export function writeDebtsToCsvFile(csvPath: string, rows: readonly DebtCsvRow[]): void {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));

  const lines = [HEADERS.join(',')];
  for (const r of sorted) {
    lines.push(
      [
        escapeCsvField(r.id),
        escapeCsvField(r.name),
        escapeCsvField(r.merchantPattern),
        escapeCsvField(serializeSourceAccounts(r.sourceAccounts)),
        String(round2(r.originalLoanAmount)),
        r.originalLoanDate ?? '',
        String(round2(r.openingBalance)),
        r.openingBalanceDate,
        r.archived ? 'true' : '',
        r.matchAmounts.length === 0 ? '' : r.matchAmounts.map(a => String(round2(a))).join(';'),
        r.kind === 'mortgage' ? 'mortgage' : '',
        r.interestRate == null ? '' : String(round2(r.interestRate)),
        r.fixedRateEndDate ?? '',
        r.repaymentType ?? '',
        r.propertyValueEstimate == null ? '' : String(round2(r.propertyValueEstimate)),
        r.propertyId ?? '',
      ].join(','),
    );
  }
  const body = `${lines.join('\n')}\n`;
  atomicWriteCsv(csvPath, body);
}

/**
 * First-boot seeding: if the CSV is missing, write header + default rows.
 * If the file already exists (even empty), leave it alone — user edits win.
 */
export function ensureDebtsCsvWithDefaults(csvPath: string): void {
  if (fs.existsSync(csvPath)) return;
  writeDebtsToCsvFile(csvPath, DEFAULT_DEBT_ROWS);
}

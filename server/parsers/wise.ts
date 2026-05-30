/**
 * Wise (formerly TransferWise) CSV Parser — UK Ltd GBP balance.
 *
 * Wise exports its transaction history as a single `transaction-history.csv`
 * covering every currency jar on the account. The columns are:
 *
 *   ID, Status, Direction, Created on, Finished on,
 *   Source fee amount, Source fee currency,
 *   Target fee amount, Target fee currency,
 *   Source name, Source amount (after fees), Source currency,
 *   Target name, Target amount (after fees), Target currency,
 *   Exchange rate, Reference, Batch, Created by, Category, Note
 *
 * The `wise-ltd` account models the GBP balance only — every row whose
 * `Source currency !== 'GBP'` is skipped here (a future `wise-fzco` row
 * plus an AED branch would cover the FZCO-owned jar). This keeps one row
 * per ledger movement and stops us double-counting a cross-currency send
 * as two transactions on the same account.
 *
 * Normalisation rules per row (only `Status === 'COMPLETED'`):
 *   - Direction IN  + Source GBP  →  +Source amount (after fees), income.
 *   - Direction OUT + Source GBP  →  -(Source amount + Source fee),   expense.
 *     Cross-currency sends embed the target details (`Target name`,
 *     `Target amount Target currency @ Exchange rate`) in the description
 *     so the downstream inter-company pair finder can key off them later.
 *   - Anything else (REFUNDED, non-GBP source, missing date) is skipped.
 *
 * The REFUNDED tax-invariance holds because Wise also writes the original
 * IN row (which is what gets refunded) — as long as both are dropped the
 * net ledger impact is zero. We explicitly drop REFUNDED rather than
 * treating it like COMPLETED so the symmetry is obvious.
 */

import type { BankParser, CSVRow, Transaction, ValidationResult } from '../types.js';
import type { InternalFeedTransactions } from '../ingestion/feeds/model.js';
import { defaultTrueLayerRowMapping } from '../ingestion/feeds/truelayer/truelayer-map-helpers.js';
import { buildCsv, formatAmount } from './lib/feed-emitter-helpers.js';

function getColumnValue(row: CSVRow, columnName: string): string {
  if (columnName in row) return row[columnName];
  const lowerCol = columnName.toLowerCase();
  const key = Object.keys(row).find(k => k.toLowerCase() === lowerCol);
  return key ? row[key] : '';
}

function parseNumber(raw: string | undefined): number {
  if (raw === undefined || raw === null) return 0;
  const trimmed = raw.toString().trim();
  if (trimmed === '') return 0;
  const cleaned = trimmed.replace(/[",\s]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Wise timestamp format: `YYYY-MM-DD HH:MM:SS`. Time component discarded. */
function parseWiseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildIncomingDescription(row: CSVRow): string {
  const reference = (getColumnValue(row, 'Reference') ?? '').trim();
  const note = (getColumnValue(row, 'Note') ?? '').trim();
  const category = (getColumnValue(row, 'Category') ?? '').trim();
  const label = note || category || 'money added';
  const suffix = reference ? ` (${reference})` : '';
  return `Wise: ${label}${suffix}`;
}

function buildOutgoingDescription(row: CSVRow): string {
  const target = (getColumnValue(row, 'Target name') ?? '').trim() || 'recipient';
  const reference = (getColumnValue(row, 'Reference') ?? '').trim();
  const targetCurrency = (getColumnValue(row, 'Target currency') ?? '').trim().toUpperCase();
  const parts: string[] = [`Wise: to ${target}`];
  if (reference) parts.push(reference);
  if (targetCurrency && targetCurrency !== 'GBP') {
    const targetAmount = parseNumber(getColumnValue(row, 'Target amount (after fees)'));
    const rate = (getColumnValue(row, 'Exchange rate') ?? '').trim();
    const formattedAmount = targetAmount.toFixed(2);
    const rateSuffix = rate ? ` @ ${rate}` : '';
    parts.push(`(${formattedAmount} ${targetCurrency}${rateSuffix})`);
  }
  return parts.join(' ');
}

const wiseParser: BankParser = {
  columns: 'auto',

  dateColumn: 'Created on',
  amountColumn: 'Source amount (after fees)',
  descriptionColumn: 'Target name',

  headers: [
    'ID', 'Status', 'Direction', 'Created on', 'Finished on',
    'Source fee amount', 'Source fee currency',
    'Target fee amount', 'Target fee currency',
    'Source name', 'Source amount (after fees)', 'Source currency',
    'Target name', 'Target amount (after fees)', 'Target currency',
    'Exchange rate', 'Reference', 'Batch', 'Created by', 'Category', 'Note',
  ] as const,

  requiredHeaders: [
    'ID', 'Status', 'Direction', 'Created on',
    'Source amount (after fees)', 'Source currency', 'Target name',
  ] as const,

  parseOptions: {
    skip_records_with_empty_values: false,
    relax_quotes: true,
  },

  validateHeaders(headers: string[]): ValidationResult {
    const normalised = headers.map(h => h.toLowerCase().trim());
    const missing = this.requiredHeaders.filter(
      req => !normalised.includes(req.toLowerCase()),
    );
    if (missing.length > 0) {
      return { valid: false, errors: [`Missing required headers: ${missing.join(', ')}`] };
    }
    return { valid: true };
  },

  parseDate: parseWiseDate,

  /**
   * Wise's export filename is just `transaction-history.csv` with no
   * date portion. Returning `null` tells the filename normaliser to
   * fall back to per-row dates (which is what we want for Wise — the
   * CSV always covers an unpredictable range).
   */
  extractFilenameDate(): string | null {
    return null;
  },

  preprocess(content: string): string {
    return content;
  },

  transform(row: CSVRow, account: string): Transaction | null {
    const status = (getColumnValue(row, 'Status') ?? '').trim().toUpperCase();
    if (status !== 'COMPLETED') return null;

    const sourceCurrency = (getColumnValue(row, 'Source currency') ?? '').trim().toUpperCase();
    if (sourceCurrency !== 'GBP') return null;

    const date = parseWiseDate(getColumnValue(row, 'Created on'));
    if (!date) return null;

    const direction = (getColumnValue(row, 'Direction') ?? '').trim().toUpperCase();
    const sourceAmount = parseNumber(getColumnValue(row, 'Source amount (after fees)'));
    if (sourceAmount <= 0) return null;

    if (direction === 'IN') {
      return {
        date,
        description: buildIncomingDescription(row),
        amount: sourceAmount,
        account,
        type: 'income',
      };
    }

    if (direction === 'OUT') {
      const sourceFee = parseNumber(getColumnValue(row, 'Source fee amount'));
      const totalDebit = sourceAmount + sourceFee;
      return {
        date,
        description: buildOutgoingDescription(row),
        amount: -totalDebit,
        account,
        type: 'expense',
      };
    }

    return null;
  },

  mapTrueLayerTransaction(raw, ctx) {
    return defaultTrueLayerRowMapping(raw, ctx);
  },

  /**
   * Emit Wise-shaped CSV from provider-neutral feed rows.
   *
   * Wise's native CSV reports `Source amount (after fees)` as **always
   * positive**, with `Direction` (`IN` / `OUT`) carrying the sign. We
   * map our inflow-positive internal amount onto the Direction column
   * and emit `Source amount` as the absolute value. Fees aren't part of
   * the AISP feed shape so `Source fee amount` emits as `0` — `transform`
   * computes `amount = -(sourceAmount + sourceFee)` for OUT, which round-
   * trips back to the original signed amount when fee is `0`.
   *
   * Status is forced to `COMPLETED` because the parser drops anything
   * else; ingestion intentionally only persists settled rows.
   */
  emitFeedTransactionsAsCsv(tx: InternalFeedTransactions): string {
    const rows = tx.rows.map<Record<string, string>>(row => {
      const direction = row.amount >= 0 ? 'IN' : 'OUT';
      const absAmount = Math.abs(row.amount);
      const finishedOn = `${row.date} 00:00:00`;
      return {
        ID: row.externalId ?? '',
        Status: 'COMPLETED',
        Direction: direction,
        'Created on': finishedOn,
        'Finished on': finishedOn,
        'Source fee amount': '0',
        'Source fee currency': row.currency,
        'Target fee amount': '0',
        'Target fee currency': row.currency,
        'Source name': '',
        'Source amount (after fees)': formatAmount(absAmount),
        'Source currency': row.currency,
        'Target name': row.counterparty ?? row.description,
        'Target amount (after fees)': formatAmount(absAmount),
        'Target currency': row.currency,
        'Exchange rate': '',
        Reference: row.reference ?? '',
        Batch: '',
        'Created by': '',
        Category: '',
        Note: '',
      };
    });
    return buildCsv(this.headers, rows);
  },
};

export default wiseParser;

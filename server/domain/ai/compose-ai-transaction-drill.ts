/**
 * Wave 03 — Hermes-style transaction drill: same composer for GET /api/ai/transactions-drill + MCP query_transactions.
 *
 * Optional-account, transfer-default, and multi-currency totals guidance lives on
 * **`AiTransactionDrillQuerySchema`** / **`AiTransactionDrillResponseSchema`** (`shared/api-contracts.ts`)
 * and the MCP **`instructions`** + **`query_transactions`** tool description (`bank-mcp-server.ts`) —
 * duplicate here intentionally avoided.
 */

import type {
  AccountName,
  AiTransactionDrillMatchMode,
  AiTransactionDrillQuery,
  AiTransactionDrillResponse,
  AiTransactionDrillRow,
  CurrencyCode,
} from '../../../shared/api-contracts.js';
import {
  AiTransactionDrillQuerySchema,
  AiTransactionDrillResponseSchema,
} from '../../../shared/api-contracts.js';
import {
  getTransactions,
  summarizeTransactionsByAccount,
  type TransactionAccountAggregateRow,
  type TransactionFilters,
  type TransactionRow,
} from '../../db/repositories/transactions.js';
import { getAccountConfig, isValidAccountName } from '../accounts/index.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';

function currencyForLedgerAccount(accountId: string): CurrencyCode {
  if (!isValidAccountName(accountId)) return 'GBP';
  return getAccountConfig(accountId as AccountName).currency;
}

function aggregateRowsByAccount(rows: TransactionRow[]): TransactionAccountAggregateRow[] {
  const byAccount = new Map<string, { rowCount: number; sumAmount: number }>();
  for (const r of rows) {
    const cur = byAccount.get(r.account) ?? { rowCount: 0, sumAmount: 0 };
    cur.rowCount += 1;
    cur.sumAmount += r.amount;
    byAccount.set(r.account, cur);
  }
  return [...byAccount.entries()]
    .map(([account, v]) => ({ account, rowCount: v.rowCount, sumAmount: v.sumAmount }))
    .sort((a, b) => a.account.localeCompare(b.account));
}

function rollupTotalsByCurrency(
  byAccount: TransactionAccountAggregateRow[],
): { currency: CurrencyCode; rowCount: number; sumAmount: number }[] {
  const byCur = new Map<CurrencyCode, { rowCount: number; sumAmount: number }>();
  for (const r of byAccount) {
    const c = currencyForLedgerAccount(r.account);
    const cur = byCur.get(c) ?? { rowCount: 0, sumAmount: 0 };
    cur.rowCount += r.rowCount;
    cur.sumAmount += r.sumAmount;
    byCur.set(c, cur);
  }
  return [...byCur.entries()]
    .map(([currency, v]) => ({ currency, rowCount: v.rowCount, sumAmount: v.sumAmount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export function drillQueryToTransactionFilters(parsed: AiTransactionDrillQuery): TransactionFilters {
  const fyTrimmed = parsed.financialYear?.trim();
  const filters: TransactionFilters = {
    account: parsed.account,
    dateFrom: parsed.dateFrom,
    dateTo: parsed.dateTo,
    financialYear:
      fyTrimmed !== undefined && fyTrimmed.length > 0 ? fyTrimmed : undefined,
    year: parsed.year,
    month: parsed.month,
    includeTransfers: parsed.includeTransfers,
    type: parsed.type,
  };
  const searchT = parsed.search?.trim();
  const merchT = parsed.merchantModalLabel?.trim();
  if (searchT !== undefined && searchT.length > 0) {
    filters.search = searchT;
  }
  if (merchT !== undefined && merchT.length > 0) {
    filters.merchantModalLabel = merchT;
    if (parsed.type === undefined) {
      filters.type = 'expense';
    }
  }
  return filters;
}

function matchModeForQuery(parsed: AiTransactionDrillQuery): AiTransactionDrillMatchMode {
  const searchT = parsed.search?.trim() ?? '';
  const merchT = parsed.merchantModalLabel?.trim() ?? '';
  if (merchT.length > 0) return 'merchant_modal';
  if (searchT.length > 0) return 'search';
  return 'none';
}

function mapRows(slice: TransactionRow[]): AiTransactionDrillRow[] {
  return slice.map(r => ({
    id: r.id,
    date: r.date,
    description: r.description,
    amount: r.amount,
    account: r.account,
    type: r.type,
  }));
}

/** Shared entry: HTTP + MCP validate with {@link AiTransactionDrillQuerySchema} first where you need issue shapes; otherwise call this with `unknown`. */
export function composeAiTransactionDrill(raw: unknown): AiTransactionDrillResponse {
  return buildAiTransactionDrillResponse(AiTransactionDrillQuerySchema.parse(raw));
}

export function buildAiTransactionDrillResponse(query: AiTransactionDrillQuery): AiTransactionDrillResponse {
  const filters = drillQueryToTransactionFilters(query);
  const matchMode = matchModeForQuery(query);

  let matchedRowCount = 0;
  let truncated = false;
  let rows: AiTransactionDrillRow[] = [];
  let byAccount: TransactionAccountAggregateRow[];

  if (query.includeRows) {
    const all = getTransactions(filters);
    matchedRowCount = all.length;
    byAccount = aggregateRowsByAccount(all);
    const limited = all.slice(0, query.limit);
    truncated = all.length > limited.length;
    rows = mapRows(limited);
  } else {
    byAccount = summarizeTransactionsByAccount(filters);
    matchedRowCount = byAccount.reduce((sum, r) => sum + r.rowCount, 0);
    truncated = false;
    rows = [];
  }

  const aggregatesByAccount = byAccount.map(r => ({
    account: r.account,
    currency: currencyForLedgerAccount(r.account),
    rowCount: r.rowCount,
    sumAmount: r.sumAmount,
  }));

  const totalsByCurrency = rollupTotalsByCurrency(byAccount);

  return AiTransactionDrillResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
    matchMode,
    includeRows: query.includeRows,
    truncated,
    matchedRowCount,
    returnedRowCount: rows.length,
    limit: query.limit,
    query,
    aggregatesByAccount,
    totalsByCurrency,
    rows,
  });
}

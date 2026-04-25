/**
 * DB-facing glue that turns the pure `findLastInvoicePaymentDate`
 * utility into a per-contract map, ready for the route layer to feed
 * into `computeAccrual`.
 *
 * Kept as its own module so route tests can `vi.mock` it — the
 * existing `contracts.test.ts` doesn't set up a DB at all, and the new
 * integration tests want to control last-payment dates deterministically
 * rather than seed real `transactions` rows.
 *
 * Scope:
 *   - For each active contract, look up its issuing entity's accounts
 *     via {@link accountsForEntity} and pull income rows from each.
 *   - Window the transactions to `lookbackDays` (default 180) so we
 *     don't scan years of history for every accrual call — an older
 *     payment would only supersede itself; a brand-new contract with
 *     no match in the window falls back correctly via
 *     {@link resolveAccrualWindowStart}.
 *   - Return a `Map<ContractId, string | null>` so the route layer can
 *     look up each contract without knowing anything about
 *     transactions or narrative tokens.
 */

import type {
  Contract,
  ContractId,
  InvoicePayment,
  Transaction,
} from '../../../shared/api-contracts.js';
import { shiftIsoDate } from '../../../shared/iso-date.js';
import { accountsForEntity } from '../accounts/queries.js';
import { findClientById } from '../clients/queries.js';
import {
  allInvoicePayments,
  listInvoicesByContractId,
} from '../invoices/queries.js';
import { getTransactions } from '../../db/repositories/transactions.js';
import { findLastInvoicePaymentDate } from './last-payment.js';

const DEFAULT_LOOKBACK_DAYS = 180;

export interface ResolveLastPaymentsInput {
  readonly contracts: readonly Contract[];
  /** ISO `YYYY-MM-DD` — the pinned "today" the calling route is using. */
  readonly today: string;
  /**
   * How many days of history to consider. Default 180 days — enough to
   * survive a 90-day payment cycle drift without pulling the whole
   * transaction history for every request.
   */
  readonly lookbackDays?: number;
}

/**
 * Scans income rows for the accounts belonging to each issuing entity
 * referenced by `contracts`. Per-entity fetch + local filter keeps the
 * DB load bounded and avoids N queries for N contracts when several
 * contracts sit under the same entity.
 */
function loadIncomeByEntity(
  contracts: readonly Contract[],
  fromDate: string,
  toDate: string,
): Map<string, Transaction[]> {
  const entities = new Set(contracts.map(c => c.issuing_entity_id));
  const byEntity = new Map<string, Transaction[]>();
  for (const entityId of entities) {
    const accounts = accountsForEntity(entityId);
    const rows: Transaction[] = [];
    for (const account of accounts) {
      const txRows = getTransactions({ account, type: 'income' });
      for (const tx of txRows) {
        if (tx.date < fromDate || tx.date > toDate) continue;
        rows.push({
          date: tx.date,
          description: tx.description,
          amount: tx.amount,
          account: tx.account,
          type: 'income',
        });
      }
    }
    byEntity.set(entityId, rows);
  }
  return byEntity;
}

/**
 * Build a per-contract lookup of `InvoicePayment` rows by joining the
 * invoice-payments registry to invoices via `invoice_id`. Done once per
 * resolver call so each contract's `findLastInvoicePaymentDate` reads
 * the slice without re-walking the whole ledger.
 */
function loadLedgerPaymentsByContract(
  contracts: readonly Contract[],
): Map<ContractId, readonly InvoicePayment[]> {
  const out = new Map<ContractId, readonly InvoicePayment[]>();
  if (contracts.length === 0) return out;
  const allPayments = allInvoicePayments();
  if (allPayments.length === 0) {
    for (const c of contracts) out.set(c.id, []);
    return out;
  }
  const paymentsByInvoiceId = new Map<string, InvoicePayment[]>();
  for (const p of allPayments) {
    const list = paymentsByInvoiceId.get(p.invoice_id);
    if (list !== undefined) list.push(p);
    else paymentsByInvoiceId.set(p.invoice_id, [p]);
  }
  for (const c of contracts) {
    const slice: InvoicePayment[] = [];
    for (const inv of listInvoicesByContractId(c.id)) {
      const rows = paymentsByInvoiceId.get(inv.id);
      if (rows !== undefined) slice.push(...rows);
    }
    out.set(c.id, slice);
  }
  return out;
}

export function resolveLastPaymentsForContracts(
  input: ResolveLastPaymentsInput,
): Map<ContractId, string | null> {
  const { contracts, today, lookbackDays = DEFAULT_LOOKBACK_DAYS } = input;
  const out = new Map<ContractId, string | null>();
  if (contracts.length === 0) return out;

  const fromDate = shiftIsoDate(today, -lookbackDays);
  const incomeByEntity = loadIncomeByEntity(contracts, fromDate, today);
  const ledgerByContract = loadLedgerPaymentsByContract(contracts);

  for (const contract of contracts) {
    const client = findClientById(contract.client_id);
    if (client === null) {
      // Registry gates should have caught this long before now; a
      // contract with a dangling client_id has no payer name to match
      // against, so we return null and let the owed window fall back
      // to month-start — consistent with "we don't know".
      out.set(contract.id, null);
      continue;
    }
    const txns = incomeByEntity.get(contract.issuing_entity_id) ?? [];
    const ledger = ledgerByContract.get(contract.id) ?? [];
    const lastPayment = findLastInvoicePaymentDate({
      contract,
      client,
      incomeTransactions: txns,
      today,
      ledgerPayments: ledger,
    });
    out.set(contract.id, lastPayment);
  }

  return out;
}

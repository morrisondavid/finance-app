/**
 * Canonical invoice ↔ bank reconciliation plan builder.
 *
 * Shared by the reconcile mutation route and the consolidated Warnings
 * feed so both paths see the same matcher inputs.
 */

import type { Client, ClientId, EntityId, Invoice } from '../../../shared/api-contracts.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { getDb } from '../../db/connection.js';
import { accountsForEntity, getAccountConfig } from '../accounts/queries.js';
import { allClients } from '../clients/index.js';
import {
  allInvoicePayments,
  listInvoicesByIssuingEntityId,
} from './queries.js';
import { listReconcilableInvoices } from './list-reconcilable-invoices.js';
import { paymentsLinkedToLedger } from './payment-ledger-links.js';
import {
  laFosseDepositAmountForMatch,
  loadLaFosseReconcileTransactions,
} from './la-fosse-reconcile-accounts.js';
import {
  planReconciliation,
  type ReconcileTransaction,
  type ReconciliationPlan,
} from './reconcile-payments.js';

/** Default look-back for reconcile plans (matches reconcile route). */
export const RECONCILE_LOOKBACK_DAYS = 180;

function loadReconcileTransactions(
  invoices: readonly Invoice[],
  windowStart: string,
  windowEnd: string,
): readonly ReconcileTransaction[] {
  if (invoices.length === 0) return [];

  const queryRows = (
    accounts: readonly string[],
    start: string,
    end: string,
  ) =>
    getDb()
      .prepare(
        `SELECT id, hash, date, description, amount, account
           FROM transactions
           WHERE type = 'income'
             AND account IN (${accounts.map(() => '?').join(', ')})
             AND date >= ? AND date <= ?
           ORDER BY date ASC`,
      )
      .all(...accounts, start, end) as readonly {
      id: number;
      hash: string;
      date: string;
      description: string;
      amount: number;
      account: string;
    }[];

  const entities = [...new Set(invoices.map(i => i.issuing_entity_id))];
  const allLaFosse =
    invoices.length > 0 && invoices.every(inv => inv.client_id === 'la-fosse');

  if (allLaFosse && entities.length === 1) {
    return loadLaFosseReconcileTransactions({
      invoiceEntityId: entities[0]!,
      windowStart,
      windowEnd,
      queryRows,
    });
  }

  const accounts: string[] = [];
  for (const entityId of entities) {
    accounts.push(...accountsForEntity(entityId));
  }
  if (accounts.length === 0) return [];

  const rows = queryRows(accounts, windowStart, windowEnd);
  const out: ReconcileTransaction[] = [];
  for (const r of rows) {
    const cfg = getAccountConfig(r.account as Parameters<typeof getAccountConfig>[0]);
    if (cfg.category !== 'business') continue;
    out.push({
      id: r.hash,
      date: r.date,
      description: r.description,
      amount: r.amount,
      currency: cfg.currency,
      account: r.account,
      entityId: cfg.entityId,
    });
  }
  return out;
}

export interface BuildReconciliationPlanInput {
  readonly entityId?: EntityId;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly now?: string;
}

function ledgerIncomeHashesForEntity(entityId?: EntityId): ReadonlySet<string> {
  const accounts: string[] = [];
  if (entityId !== undefined) {
    accounts.push(...accountsForEntity(entityId));
  } else {
    accounts.push(...accountsForEntity('autonize-it-ltd'));
    accounts.push(...accountsForEntity('autonize-it-fzco'));
  }
  if (accounts.length === 0) return new Set();

  const rows = getDb()
    .prepare(
      `SELECT hash FROM transactions
         WHERE type = 'income'
           AND account IN (${accounts.map(() => '?').join(', ')})`,
    )
    .all(...accounts) as readonly { hash: string }[];

  return new Set(rows.map(r => r.hash));
}

function buildReconciliationPlanInternal(
  input: BuildReconciliationPlanInput,
): ReconciliationPlan {
  const ledgerBankTxIds = ledgerIncomeHashesForEntity(input.entityId);
  const scopedInvoices = listReconcilableInvoices(input.entityId, ledgerBankTxIds);

  if (input.entityId !== undefined) {
    void listInvoicesByIssuingEntityId(input.entityId);
  }

  const transactions = loadReconcileTransactions(
    scopedInvoices,
    input.windowStart,
    input.windowEnd,
  );

  const clientsById = new Map<ClientId, Client>(
    allClients().map(c => [c.id, c] as const),
  );

  const allLaFosse =
    scopedInvoices.length > 0
    && scopedInvoices.every(inv => inv.client_id === 'la-fosse');

  return planReconciliation({
    invoices: scopedInvoices,
    transactions,
    clientsById,
    existingPayments: paymentsLinkedToLedger(allInvoicePayments(), ledgerBankTxIds),
    options: {
      now: input.now ?? todayIsoLocal(),
      resolveDepositAmount: allLaFosse ? laFosseDepositAmountForMatch : undefined,
    },
  });
}

/**
 * Build a reconciliation plan, optionally scoped to one issuing entity.
 */
export function buildReconciliationPlan(
  input: BuildReconciliationPlanInput,
): ReconciliationPlan {
  return buildReconciliationPlanInternal(input);
}

export interface BuildEntityReconciliationPlanInput {
  readonly entityId: EntityId;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly now?: string;
}

/**
 * Build a reconciliation plan for one entity over a date window.
 */
export function buildEntityReconciliationPlan(
  input: BuildEntityReconciliationPlanInput,
): ReconciliationPlan {
  return buildReconciliationPlanInternal(input);
}

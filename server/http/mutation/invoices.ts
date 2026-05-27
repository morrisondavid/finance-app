/**
 * Mutations backing POST `/api/invoices/generate` and `/reconcile` — Express + MCP.
 */

import { z } from 'zod';
import {
  allInvoicePayments,
  createInvoice,
  findInvoiceById,
  InvoiceSchema,
  listInvoicesByStatus,
  listInvoicesByIssuingEntityId,
  planReconciliation,
  recordInvoicePayments,
  updateInvoice,
  writeInvoicePdf,
  type Invoice,
  type ReconcileTransaction,
  type ReconciliationPlan,
} from '../../domain/invoices/index.js';
import { findContractById } from '../../domain/contracts/index.js';
import { allClients, findClientById } from '../../domain/clients/index.js';
import { companyById } from '../../domain/company/index.js';
import { shiftIsoDate, todayIsoLocal } from '../../../shared/iso-date.js';
import { EntityIdSchema, type Client, type ClientId, type EntityId } from '../../../shared/api-contracts.js';
import { accountsForEntity, getAccountConfig } from '../../domain/accounts/queries.js';
import { getDb } from '../../db/connection.js';
import type { JsonMutationResult } from './types.js';

const RECONCILE_LOOKBACK_DAYS = 180;

/** POST `/generate` — same `{ invoice }` envelope as `/api/invoices/generate`. */
export const InvoiceGenerateBodySchema = z.object({
  invoice: InvoiceSchema,
});

export const InvoiceReconcileBodySchema = z.object({
  dryRun: z.boolean().optional(),
  entityId: EntityIdSchema.optional(),
});

function rewindToDraftOrSkip(invoiceId: string): void {
  const existing = findInvoiceById(invoiceId);
  if (existing === null) return;
  if (existing.status === 'draft' && existing.pdf_path === null) return;
  updateInvoice({
    invoiceId,
    patch: { status: 'draft', pdf_path: null },
  });
}

/**
 * POST `/api/invoices/generate` — persists draft, renders PDF to disk, marks issued (**side effects**).
 */
export async function mutateInvoiceGenerate(body: unknown): Promise<JsonMutationResult> {
  const parsed = InvoiceGenerateBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: 'Invalid request', details: parsed.error.issues },
    };
  }

  const draft: Invoice = {
    ...parsed.data.invoice,
    status: 'draft',
    pdf_path: null,
  };

  const contractForGenerate = findContractById(draft.contract_id);
  if (contractForGenerate === null) {
    return { status: 400, body: { error: 'Draft references unknown contract' } };
  }
  if (contractForGenerate.invoice_mechanism !== 'supplier-issued') {
    return {
      status: 400,
      body: {
        error: 'self-bill-contract',
        message:
          'This contract uses self-bill; supplier invoice generation does not apply. Use ingest instead.',
      },
    };
  }

  const createResult = createInvoice({ invoice: draft });
  if (!createResult.ok) {
    if (createResult.code === 'duplicate-id') {
      return {
        status: 409,
        body: { error: 'duplicate-id', invoiceId: createResult.invoiceId },
      };
    }
    return {
      status: 400,
      body: { error: 'Invalid request', details: createResult.issues },
    };
  }

  const contract = findContractById(createResult.invoice.contract_id);
  const client = findClientById(createResult.invoice.client_id);
  const company = companyById(createResult.invoice.issuing_entity_id);
  if (contract === null || client === null || company === null) {
    rewindToDraftOrSkip(createResult.invoice.id);
    return { status: 400, body: { error: 'Draft references unknown entities' } };
  }

  try {
    const writeResult = await writeInvoicePdf({
      invoice: createResult.invoice,
      company,
      client,
    });

    const patchResult = updateInvoice({
      invoiceId: createResult.invoice.id,
      patch: { status: 'issued', pdf_path: writeResult.relativePath },
    });

    if (!patchResult.ok) {
      return {
        status: 500,
        body: { error: 'Failed to flip invoice to issued' },
      };
    }

    return { status: 200, body: { invoice: patchResult.invoice } };
  } catch (err) {
    rewindToDraftOrSkip(createResult.invoice.id);
    return {
      status: 500,
      body: {
        error: 'PDF render failed',
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function loadReconcileTransactions(
  invoices: readonly Invoice[],
  windowStart: string,
  windowEnd: string,
): readonly ReconcileTransaction[] {
  if (invoices.length === 0) return [];
  const entities = new Set(invoices.map(i => i.issuing_entity_id));
  const accounts: string[] = [];
  for (const entityId of entities) {
    accounts.push(...accountsForEntity(entityId));
  }
  if (accounts.length === 0) return [];

  const placeholders = accounts.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(
      `SELECT id, date, description, amount, account
         FROM transactions
         WHERE type = 'income'
           AND account IN (${placeholders})
           AND date >= ? AND date <= ?
         ORDER BY date ASC`,
    )
    .all(...accounts, windowStart, windowEnd) as readonly {
    id: number;
    date: string;
    description: string;
    amount: number;
    account: string;
  }[];

  const out: ReconcileTransaction[] = [];
  for (const r of rows) {
    const cfg = getAccountConfig(r.account as Parameters<typeof getAccountConfig>[0]);
    if (cfg.category !== 'business') continue;
    out.push({
      id: String(r.id),
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

/**
 * POST `/api/invoices/reconcile`.
 * **`dryRun` defaults true** — set `dryRun: false` to persist proposed payments (**writes DB**).
 */
export function mutateInvoiceReconcile(body: unknown): JsonMutationResult {
  const parsed = InvoiceReconcileBodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: 'Invalid request', details: parsed.error.issues },
    };
  }

  /** MCP parity: omitting dryRun matches HTTP (`?? true`). */
  const dryRun = parsed.data.dryRun ?? true;
  const entityId: EntityId | null = parsed.data.entityId ?? null;

  const issued = listInvoicesByStatus('issued');
  const scopedInvoices =
    entityId === null ? issued : issued.filter(inv => inv.issuing_entity_id === entityId);

  const today = todayIsoLocal();
  const windowStart = shiftIsoDate(today, -RECONCILE_LOOKBACK_DAYS);

  const transactions = loadReconcileTransactions(scopedInvoices, windowStart, today);

  const clientsById = new Map<ClientId, Client>(allClients().map(c => [c.id, c] as const));
  if (entityId !== null) {
    void listInvoicesByIssuingEntityId(entityId);
  }

  const plan: ReconciliationPlan = planReconciliation({
    invoices: scopedInvoices,
    transactions,
    clientsById,
    existingPayments: allInvoicePayments(),
    options: { now: today },
  });

  if (dryRun) {
    return {
      status: 200,
      body: {
        dryRun: true,
        plan,
        persisted: null,
      },
    };
  }

  const result = recordInvoicePayments({ payments: plan.proposedPayments });
  if (!result.ok) {
    if (result.code === 'duplicate-id') {
      return {
        status: 409,
        body: {
          error: 'duplicate-id',
          invoicePaymentId: result.invoicePaymentId,
        },
      };
    }
    if (result.code === 'duplicate-bank-tx') {
      return {
        status: 409,
        body: {
          error: 'duplicate-bank-tx',
          bankTransactionId: result.bankTransactionId,
        },
      };
    }
    if (result.code === 'unknown-invoice') {
      return {
        status: 400,
        body: {
          error: 'unknown-invoice',
          invoiceId: result.invoiceId,
        },
      };
    }
    return {
      status: 400,
      body: { error: 'Invalid request', details: result.issues },
    };
  }

  return {
    status: 200,
    body: {
      dryRun: false,
      plan,
      persisted: result.payments,
    },
  };
}

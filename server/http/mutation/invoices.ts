/**
 * Mutations backing POST `/api/invoices/generate` and `/reconcile` — Express + MCP.
 */

import { z } from 'zod';
import {
  allInvoices,
  applyInvoiceStatusAfterPayments,
  autoReconcileHighConfidence,
  buildReconciliationPlan,
  createInvoice,
  findInvoiceById,
  InvoiceSchema,
  recordInvoicePayments,
  RECONCILE_LOOKBACK_DAYS,
  updateInvoice,
  writeInvoicePdf,
  type Invoice,
} from '../../domain/invoices/index.js';
import { violationForMonthlySupplierInvoiceGenerate } from '../../domain/invoices/invoice-generate-monthly-guards.js';
import { findContractById } from '../../domain/contracts/index.js';
import { findClientById } from '../../domain/clients/index.js';
import { companyById } from '../../domain/company/index.js';
import { shiftIsoDate, todayIsoLocal } from '../../../shared/iso-date.js';
import { EntityIdSchema, type EntityId } from '../../../shared/api-contracts.js';
import type { JsonMutationResult } from './types.js';

/** POST `/generate` — same `{ invoice }` envelope as `/api/invoices/generate`. */
export const InvoiceGenerateBodySchema = z.object({
  invoice: InvoiceSchema,
  /** Skip strict monthly gap-list blocking (still enforces occupancy / other rules). */
  allowOutsideGapList: z.boolean().optional(),
});

export const InvoiceReconcileBodySchema = z.object({
  dryRun: z.boolean().optional(),
  /** When true, auto-persist reference-exact matches only. */
  mode: z.enum(['dry-run', 'auto', 'persist-all']).optional(),
  entityId: EntityIdSchema.optional(),
});

function rewindToDraftOrSkip(invoiceId: string): void {
  const existing = findInvoiceById(invoiceId);
  if (existing === null) return;
  if (existing.status === 'draft') return;
  updateInvoice({
    invoiceId,
    patch: { status: 'draft' },
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

  const monthlyGuard = violationForMonthlySupplierInvoiceGenerate({
    draft,
    contract: contractForGenerate,
    allInvoices: allInvoices(),
    today: todayIsoLocal(),
    allowOutsideGapList: parsed.data.allowOutsideGapList,
  });
  if (monthlyGuard !== undefined) {
    return { status: monthlyGuard.status, body: monthlyGuard.body };
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
    await writeInvoicePdf({
      invoice: createResult.invoice,
      company,
      client,
    });

    const patchResult = updateInvoice({
      invoiceId: createResult.invoice.id,
      patch: { status: 'issued' },
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

  const entityId: EntityId | undefined = parsed.data.entityId;
  const today = todayIsoLocal();
  const windowStart = shiftIsoDate(today, -RECONCILE_LOOKBACK_DAYS);

  const mode =
    parsed.data.mode
    ?? (parsed.data.dryRun === false ? 'persist-all' : 'dry-run');

  if (mode === 'auto') {
    const auto = autoReconcileHighConfidence({
      entityId,
      windowStart,
      windowEnd: today,
      now: today,
    });
    return {
      status: 200,
      body: {
        mode: 'auto',
        dryRun: false,
        plan: auto.plan,
        persisted: auto.persisted,
        statusUpdates: auto.statusUpdates,
      },
    };
  }

  const plan = buildReconciliationPlan({
    entityId,
    windowStart,
    windowEnd: today,
    now: today,
  });

  if (mode === 'dry-run') {
    return {
      status: 200,
      body: {
        mode: 'dry-run',
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

  const statusUpdates = applyInvoiceStatusAfterPayments(result.payments);

  return {
    status: 200,
    body: {
      mode: 'persist-all',
      dryRun: false,
      plan,
      persisted: result.payments,
      statusUpdates,
    },
  };
}

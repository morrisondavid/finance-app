/**
 * Mutations backing POST `/api/invoices/generate` and `/reconcile` — Express + MCP.
 */

import { z } from 'zod';
import {
  allInvoices,
  autoReconcileHighConfidence,
  buildReconciliationPlan,
  createInvoice,
  findInvoiceById,
  InvoiceSchema,
  reconcileInvoicesPersist,
  RECONCILE_LOOKBACK_DAYS,
  summariseReconciliationPlan,
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
import { publishGeneratedInvoiceArtifacts } from '../../ingestion/invoice-upload-durable-publish.js';
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
  /** Scope persist (and dry-run summary) to payments settling this invoice. */
  invoiceId: z.string().optional(),
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

    await publishGeneratedInvoiceArtifacts(patchResult.invoice);

    try {
      autoReconcileHighConfidence({
        entityId: patchResult.invoice.issuing_entity_id,
        windowStart: shiftIsoDate(todayIsoLocal(), -RECONCILE_LOOKBACK_DAYS),
        windowEnd: todayIsoLocal(),
        now: todayIsoLocal(),
      });
    } catch (err) {
      console.error('Post-issue auto-reconcile failed:', err);
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
  const invoiceId = parsed.data.invoiceId;
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
        summary: summariseReconciliationPlan(auto.plan, auto.persisted),
      },
    };
  }

  if (mode === 'dry-run') {
    const plan = buildReconciliationPlan({
      entityId,
      windowStart,
      windowEnd: today,
      now: today,
    });
    const scoped =
      invoiceId === undefined
        ? plan.proposedPayments
        : plan.proposedPayments.filter(p => p.invoice_id === invoiceId);
    return {
      status: 200,
      body: {
        mode: 'dry-run',
        dryRun: true,
        plan,
        persisted: null,
        summary: summariseReconciliationPlan(plan, scoped),
      },
    };
  }

  const result = reconcileInvoicesPersist({ entityId, invoiceId, now: today });
  if (!result.ok) {
    const failure = result.failure;
    if (failure.code === 'duplicate-id') {
      return {
        status: 409,
        body: {
          error: 'duplicate-id',
          invoicePaymentId: failure.invoicePaymentId,
        },
      };
    }
    if (failure.code === 'duplicate-bank-tx') {
      return {
        status: 409,
        body: {
          error: 'duplicate-bank-tx',
          bankTransactionId: failure.bankTransactionId,
        },
      };
    }
    if (failure.code === 'unknown-invoice') {
      return {
        status: 400,
        body: {
          error: 'unknown-invoice',
          invoiceId: failure.invoiceId,
        },
      };
    }
    return {
      status: 400,
      body: { error: 'Invalid request', details: failure.issues },
    };
  }

  return {
    status: 200,
    body: {
      mode: 'persist-all',
      dryRun: false,
      plan: result.plan,
      persisted: result.persisted,
      statusUpdates: result.statusUpdates,
      summary: result.summary,
    },
  };
}

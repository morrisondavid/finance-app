/**
 * Invoice payments registry — sibling of `registry.ts` for
 * `invoices/invoice_payments.csv`.
 *
 * Phase 4 of §1.3 introduces the first writers (`recordInvoicePayments`)
 * and readers (`findLastInvoicePaymentDate`) of this CSV. The registry
 * follows the canonical pattern (`createRegistry` + index-builders) so
 * consumers read named indexes rather than `.filter` over `all`.
 *
 * Indexes are intentionally narrow:
 *
 *   - `byId`              — primary key.
 *   - `byInvoiceId`       — every payment row for a given invoice
 *     (group; multi-row supported so partial payments / future
 *     refunds split across deposits don't need a schema change).
 *   - `byBankTransactionId` — every payment row claiming a bank
 *     deposit (grouped; batched remittances may split one deposit
 *     across several invoices).
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type {
  InvoiceId,
  InvoicePayment,
  InvoicePaymentId,
} from '../../../shared/api-contracts.js';
import { createRegistry } from '../_shared/create-registry.js';
import { groupBy, indexBy } from '../_shared/index-builders.js';
import {
  getInvoicePaymentsCsvPath,
  readInvoicePaymentsCsvFile,
} from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_INVOICE_PAYMENTS_DIR = path.join(
  __dirname,
  '../../../invoices',
);

export interface InvoicePaymentRegistry {
  readonly all: readonly InvoicePayment[];
  readonly indexes: {
    readonly byId: ReadonlyMap<InvoicePaymentId, InvoicePayment>;
    readonly byInvoiceId: ReadonlyMap<InvoiceId, readonly InvoicePayment[]>;
    readonly byBankTransactionId: ReadonlyMap<string, readonly InvoicePayment[]>;
  };
}

export function buildInvoicePaymentRegistryFromData(
  all: readonly InvoicePayment[],
): InvoicePaymentRegistry {
  const byId = indexBy(all, p => p.id, { indexName: 'invoice-payments.byId' });
  const byBankTransactionId = groupBy(all, p => p.bank_transaction_id);
  const byInvoiceId = groupBy(all, p => p.invoice_id);

  return {
    all,
    indexes: {
      byId,
      byInvoiceId,
      byBankTransactionId,
    },
  };
}

export function buildInvoicePaymentRegistry(
  invoicesDir: string = DEFAULT_INVOICE_PAYMENTS_DIR,
): InvoicePaymentRegistry {
  return buildInvoicePaymentRegistryFromData(
    readInvoicePaymentsCsvFile(getInvoicePaymentsCsvPath(invoicesDir)),
  );
}

const handle = createRegistry<InvoicePaymentRegistry>({
  name: 'invoice-payments',
  build: () => buildInvoicePaymentRegistry(),
});

export const getInvoicePaymentRegistry = handle.get;
export const invalidateInvoicePaymentRegistry = handle.invalidate;
export const __resetInvoicePaymentRegistryForTests = handle.__resetForTests;

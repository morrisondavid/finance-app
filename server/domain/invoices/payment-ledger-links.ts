/**
 * Filter invoice payment rows to those whose bank_transaction_id still
 * exists in the ledger. Orphan rows (wrong hash after re-ingest) must not
 * suppress reconciliation or leave deposits unmatched.
 */

import type { InvoicePayment } from '../../../shared/api-contracts.js';

export function paymentsLinkedToLedger(
  payments: readonly InvoicePayment[],
  ledgerBankTxIds: ReadonlySet<string>,
): readonly InvoicePayment[] {
  return payments.filter(p => ledgerBankTxIds.has(p.bank_transaction_id));
}

export function invoiceIdsWithLedgerLinkedPayments(
  payments: readonly InvoicePayment[],
  ledgerBankTxIds: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set(
    paymentsLinkedToLedger(payments, ledgerBankTxIds).map(p => p.invoice_id),
  );
}

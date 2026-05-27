/**
 * Outbound delivery façade — monthly invoice notice today; slice 2 accountant packs can call the same primitives.
 */

import type { Invoice } from '../invoices/schema.js';
import {
  sendInvoiceIssuedNoticeIfConfigured,
  type InvoiceIssuedNoticeResult,
} from './send-invoice-issued-notice.js';

export async function deliverInvoiceIssuedTransactionalNotice(
  invoice: Invoice,
): Promise<InvoiceIssuedNoticeResult> {
  return sendInvoiceIssuedNoticeIfConfigured(invoice);
}

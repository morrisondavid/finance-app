/**
 * Single adapter surface for outbound invoice notices (Resend + JSONL outbox).
 */

import type { Invoice } from '../invoices/schema.js';
import {
  sendInvoiceIssuedNoticeIfConfigured,
  type InvoiceIssuedNoticeResult,
} from './send-invoice-issued-notice.js';

export type { InvoiceIssuedNoticeResult };

export async function deliverInvoiceIssuedNotice(invoice: Invoice): Promise<InvoiceIssuedNoticeResult> {
  return sendInvoiceIssuedNoticeIfConfigured(invoice);
}

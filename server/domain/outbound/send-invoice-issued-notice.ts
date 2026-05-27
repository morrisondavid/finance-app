/**
 * Deliver a transactional email after invoice issuance via Resend HTTP API (`fetch`).
 */

import type { Invoice } from '../invoices/schema.js';

import { appendInvoiceDeliveryOutbox, invoiceDeliveryRecordedForInvoiceId } from './invoice-delivery-outbox.js';
import { INVOICE_ISSUED_NOTICE_TO_DEFAULT } from './invoice-delivery-recipients.js';

const RESEND_API_URL = 'https://api.resend.com/emails';

export interface InvoiceIssuedNoticeResult {
  readonly attempted: boolean;
  readonly disposition:
    | 'skipped_duplicate'
    | 'skipped_no_api_key'
    | 'skipped_missing_from_address'
    | 'sent'
    | 'failed_http';
  readonly detail?: string;
}

function notificationToEmail(): string {
  const raw = process.env.RESEND_NOTIFICATION_TO?.trim();
  return raw === undefined || raw === '' ? INVOICE_ISSUED_NOTICE_TO_DEFAULT : raw;
}

function fromEmail(): string | undefined {
  const raw = process.env.RESEND_FROM?.trim();
  return raw === undefined || raw === '' ? undefined : raw;
}

/**
 * Sends a minimal text notice; always records **`skipped_*` / duplicate** to the JSONL outbox first.
 */
export async function sendInvoiceIssuedNoticeIfConfigured(invoice: Invoice): Promise<InvoiceIssuedNoticeResult> {
  if (invoiceDeliveryRecordedForInvoiceId(invoice.id)) {
    return { attempted: false, disposition: 'skipped_duplicate' };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (apiKey === undefined || apiKey === '') {
    appendInvoiceDeliveryOutbox({
      invoiceId: invoice.id,
      disposition: 'skipped_no_api_key',
      detail: 'RESEND_API_KEY unset',
    });
    return {
      attempted: false,
      disposition: 'skipped_no_api_key',
      detail: 'RESEND_API_KEY unset',
    };
  }

  const from = fromEmail();
  if (from === undefined) {
    appendInvoiceDeliveryOutbox({
      invoiceId: invoice.id,
      disposition: 'skipped_missing_from_address',
      detail: 'RESEND_FROM unset',
    });
    return {
      attempted: false,
      disposition: 'skipped_missing_from_address',
      detail: 'RESEND_FROM unset',
    };
  }

  const to = notificationToEmail();
  const subject = `Issued invoice ${invoice.invoice_number}`;
  const text = [
    `Invoice ${invoice.invoice_number} (${invoice.id}) issued.`,
    `Client ${invoice.client_id} · Period ${invoice.period_start} → ${invoice.period_end}`,
    `Total ${invoice.total} ${invoice.currency}`,
    `PDF path: ${invoice.pdf_path ?? 'n/a'}`,
  ].join('\n');

  let response: Response;
  try {
    response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
      }),
    });
  } catch (err) {
    appendInvoiceDeliveryOutbox({
      invoiceId: invoice.id,
      disposition: 'failed_http',
      detail: err instanceof Error ? err.message : String(err),
    });
    return {
      attempted: true,
      disposition: 'failed_http',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (!response.ok) {
    const body = await response.text();
    appendInvoiceDeliveryOutbox({
      invoiceId: invoice.id,
      disposition: 'failed_http',
      detail: `${response.status} ${body.slice(0, 500)}`,
    });
    return {
      attempted: true,
      disposition: 'failed_http',
      detail: `${response.status} ${body}`,
    };
  }

  appendInvoiceDeliveryOutbox({ invoiceId: invoice.id, disposition: 'sent' });
  return { attempted: true, disposition: 'sent' };
}

/**
 * Append-only JSONL outbox for idempotent invoice email delivery bookkeeping.
 */

import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../../repo-root.js';

const RELATIVE_OUTBOX_PATH = path.join('data', 'invoice-delivery-outbox.jsonl');

function outboxAbsolutePath(): string {
  return path.join(REPO_ROOT, RELATIVE_OUTBOX_PATH);
}

export interface InvoiceDeliveryOutboxAppend {
  readonly invoiceId: string;
  readonly disposition:
    | 'sent'
    | 'skipped_duplicate'
    | 'skipped_no_api_key'
    | 'skipped_missing_from_address'
    | 'failed_http';
  readonly detail?: string | undefined;
}

export function invoiceDeliveryRecordedForInvoiceId(invoiceId: string): boolean {
  const p = outboxAbsolutePath();
  if (!fs.existsSync(p)) return false;
  const txt = fs.readFileSync(p, 'utf8');
  for (const line of txt.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    try {
      const row: unknown = JSON.parse(t);
      if (
        typeof row === 'object'
        && row !== null
        && 'invoiceId' in row
        && typeof (row as { invoiceId: unknown }).invoiceId === 'string'
        && (row as { invoiceId: string }).invoiceId === invoiceId
      ) {
        return true;
      }
    } catch {
      /* skip malformed */
    }
  }
  return false;
}

export function appendInvoiceDeliveryOutbox(entry: InvoiceDeliveryOutboxAppend): void {
  const dir = path.dirname(outboxAbsolutePath());
  fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify({
    at: new Date().toISOString(),
    invoiceId: entry.invoiceId,
    disposition: entry.disposition,
    ...(entry.detail === undefined ? {} : { detail: entry.detail }),
  });
  fs.appendFileSync(outboxAbsolutePath(), `${payload}\n`, 'utf8');
}

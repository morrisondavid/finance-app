/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { parseInvoiceRow } from '../domain/invoices/csv-io.js';
import { dcInvoice001 } from '../domain/invoices/test-helpers.js';
import {
  collectGeneratedInvoiceDurableRelPaths,
  collectInvoiceUploadDurableRelPaths,
} from './invoice-upload-durable-publish.js';
import type { InvoiceUploadIngestResult } from '../types.js';
import { REPO_ROOT } from '../repo-root.js';
import path from 'path';

function touch(
  outcome: InvoiceUploadIngestResult,
  archivedAbsolutePath?: string,
) {
  return { outcome, archivedAbsolutePath };
}

describe('collectInvoiceUploadDurableRelPaths', () => {
  it('collects ingested PDF paths and invoices.csv when any row ingests', () => {
    const paths = collectInvoiceUploadDurableRelPaths([
      touch({ filename: 'a.pdf', outcome: 'ingested', invoiceId: 'EG-0099' }),
      touch({ filename: 'b.pdf', outcome: 'archived-only', code: 'no-parser-match' }),
    ]);

    expect(paths).toContain('invoices/ingested/EG-0099.pdf');
    expect(paths).toContain('invoices/invoices.csv');
  });

  it('includes archived-only paths under invoices/', () => {
    const archivePath = path.join(REPO_ROOT, 'invoices', 'unknown-self-bill.pdf');
    const paths = collectInvoiceUploadDurableRelPaths([
      touch(
        {
          filename: 'unknown-self-bill.pdf',
          outcome: 'archived-only',
          code: 'no-parser-match',
        },
        archivePath,
      ),
    ]);

    expect(paths).toEqual(['invoices/unknown-self-bill.pdf']);
  });

  it('returns empty when batch is failed-only', () => {
    const paths = collectInvoiceUploadDurableRelPaths([
      touch({ filename: 'bad.pdf', outcome: 'failed', code: 'read-failed' }),
    ]);
    expect(paths).toEqual([]);
  });
});

describe('collectGeneratedInvoiceDurableRelPaths', () => {
  it('collects generated PDF path and invoices.csv for supplier-issued invoice', () => {
    const invoice = parseInvoiceRow({
      ...dcInvoice001,
      id: 'DC-011',
      invoice_number: 'DC-011',
      payment_reference: 'DC-011',
      status: 'issued',
    });

    expect(collectGeneratedInvoiceDurableRelPaths(invoice)).toEqual([
      'invoices/generated/DC-011.pdf',
      'invoices/invoices.csv',
    ]);
  });
});

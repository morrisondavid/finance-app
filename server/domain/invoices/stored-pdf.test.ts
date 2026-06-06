import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { isInvoiceStoredPdfAvailable, invoiceStoredPdfAbsolutePath } from './stored-pdf.js';
import { parseInvoiceRow } from './csv-io.js';
import { dcInvoice001 } from './test-helpers.js';
import { REPO_ROOT } from '../statements/statement-files-catalog.js';

describe('isInvoiceStoredPdfAvailable', () => {
  const base = parseInvoiceRow(dcInvoice001);

  it('false when no file exists at canonical path', () => {
    expect(
      isInvoiceStoredPdfAvailable({
        ...base,
        id: 'DC-no-archived-file',
      }),
    ).toBe(false);
  });

  it('true when canonical generated PDF exists', () => {
    const id = 'DC-stored-pdf-canonical';
    const rel = `invoices/generated/${id}.pdf`;
    const abs = path.join(REPO_ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from('%PDF-1.4\n'));
    try {
      expect(
        isInvoiceStoredPdfAvailable({
          ...base,
          id,
        }),
      ).toBe(true);
      expect(invoiceStoredPdfAbsolutePath({ ...base, id })).toBe(abs);
    } finally {
      fs.rmSync(abs, { force: true });
    }
  });

  it('false when canonical path is missing', () => {
    expect(
      isInvoiceStoredPdfAvailable({
        ...base,
        id: 'DC-does-not-exist',
      }),
    ).toBe(false);
  });
});

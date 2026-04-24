import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeInvoicePdf, getGeneratedPdfPath, getRelativePdfPath } from './write.js';
import { parseInvoiceRow } from '../csv-io.js';
import { parseCompanyRow } from '../../company/csv-io.js';
import { parseClientRow } from '../../clients/csv-io.js';
import { dcInvoice001 } from '../test-helpers.js';
import { ukRow } from '../../company/test-helpers.js';

const DC_CLIENT_ROW = {
  id: 'delta-capita',
  legal_name: 'Delta Capita Ltd',
  trading_name: 'Delta Capita',
  kind: 'direct',
  vat_number: 'TBC',
  billing_address: '2nd Floor, 40 Bank Street, Canary Wharf, London, E14 5NR',
  primary_contact_name: 'Lily Lovegrove-Saville',
  primary_contact_email: 'lily.lovegrove@deltacapita.com',
  secondary_contact_name: '',
  secondary_contact_email: '',
  hr_contact_name: '',
  hr_contact_email: '',
  accounts_contact_name: '',
  accounts_contact_email: '',
  cc_emails: '',
  holiday_system_url: '',
  client_assigned_email: '',
  end_client_legal_name: '',
  end_client_address: '',
  end_client_primary_contact_name: '',
  end_client_primary_contact_email: '',
  end_client_secondary_contact_name: '',
  end_client_secondary_contact_email: '',
  active: 'true',
  updated_at: '2026-04-21',
};

describe('writeInvoicePdf', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-pdf-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a valid PDF to <invoicesDir>/generated/<id>.pdf', async () => {
    const invoice = parseInvoiceRow(dcInvoice001);
    const company = parseCompanyRow(ukRow);
    const client = parseClientRow(DC_CLIENT_ROW);

    const result = await writeInvoicePdf({
      invoice,
      company,
      client,
      invoicesDir: tmpDir,
    });

    expect(result.absolutePath).toBe(getGeneratedPdfPath(invoice, tmpDir));
    expect(result.relativePath).toBe(getRelativePdfPath(invoice));
    expect(result.sizeBytes).toBeGreaterThan(0);

    const onDisk = fs.readFileSync(result.absolutePath);
    expect(onDisk.length).toBe(result.sizeBytes);
    // PDF magic header — every conformant PDF starts with `%PDF-`.
    expect(onDisk.slice(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('is idempotent — writing twice leaves a single file', async () => {
    const invoice = parseInvoiceRow(dcInvoice001);
    const company = parseCompanyRow(ukRow);
    const client = parseClientRow(DC_CLIENT_ROW);

    await writeInvoicePdf({ invoice, company, client, invoicesDir: tmpDir });
    await writeInvoicePdf({ invoice, company, client, invoicesDir: tmpDir });

    const generatedDir = path.dirname(getGeneratedPdfPath(invoice, tmpDir));
    const entries = fs.readdirSync(generatedDir);
    expect(entries).toEqual([`${invoice.id}.pdf`]);
  });
});

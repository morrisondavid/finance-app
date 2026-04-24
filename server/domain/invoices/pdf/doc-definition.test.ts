import { describe, it, expect } from 'vitest';
import { buildInvoiceDocDefinition } from './doc-definition.js';
import { parseInvoiceRow } from '../csv-io.js';
import { parseCompanyRow } from '../../company/csv-io.js';
import { parseClientRow } from '../../clients/csv-io.js';
import {
  dcInvoice001,
  fzcoInvoice001,
} from '../test-helpers.js';
import { ukRow, uaeRow } from '../../company/test-helpers.js';

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

const LA_FOSSE_CLIENT_ROW = {
  id: 'la-fosse',
  legal_name: 'La Fosse Associates Limited',
  trading_name: 'La Fosse',
  kind: 'agency',
  vat_number: '360 0265 37',
  billing_address: '1st Floor, 11-19 Artillery Row, London, SW1P 1RT',
  primary_contact_name: 'TBC',
  primary_contact_email: 'TBC',
  secondary_contact_name: '',
  secondary_contact_email: '',
  hr_contact_name: '',
  hr_contact_email: '',
  accounts_contact_name: '',
  accounts_contact_email: '',
  cc_emails: '',
  holiday_system_url: '',
  client_assigned_email: '',
  end_client_legal_name: 'The Edwin Group Ltd',
  end_client_address:
    'First Floor (South), Cathedral Buildings, Dean Street, Newcastle Upon Tyne, NE1 1PG',
  end_client_primary_contact_name: 'Diane Sequeira',
  end_client_primary_contact_email: 'Diane@edwin.group',
  end_client_secondary_contact_name: '',
  end_client_secondary_contact_email: '',
  active: 'true',
  updated_at: '2026-04-24',
};

describe('buildInvoiceDocDefinition', () => {
  it('produces a UK-shape definition with VAT row and sort/account footer', () => {
    const invoice = parseInvoiceRow(dcInvoice001);
    const company = parseCompanyRow(ukRow);
    const client = parseClientRow(DC_CLIENT_ROW);

    const dd = buildInvoiceDocDefinition(invoice, company, client);
    const dump = JSON.stringify(dd);

    expect(dd.info?.title).toBe('Invoice DC-001');
    expect(dd.defaultStyle?.font).toBe('Helvetica');
    expect(dump).toContain('Autonize IT Limited');
    expect(dump).toContain('Delta Capita Ltd');
    expect(dump).toContain('VAT (20%)');
    expect(dump).toContain('£660.00');
    expect(dump).toContain('Sort code: 20-25-19');
    expect(dump).toContain('Account number: 63648923');
    expect(dump).not.toContain('IBAN:');
    expect(dump).toContain('23/06/25\u201330/06/25');
    expect(dump).toContain('Invoice / payment ref.');
    expect(dump).not.toContain('please quote on payment');
    expect(dump).not.toContain('Payment reference');
    expect(dump).toContain('6 days at £550.00 / day');
  });

  it('shows separate invoice and payment rows when references differ', () => {
    const base = parseInvoiceRow(dcInvoice001);
    const invoice = { ...base, payment_reference: 'BANK-REF-ONLY' };
    const dd = buildInvoiceDocDefinition(
      invoice,
      parseCompanyRow(ukRow),
      parseClientRow(DC_CLIENT_ROW),
    );
    const dump = JSON.stringify(dd);
    expect(dump).toContain('Invoice no.');
    expect(dump).toContain('Payment reference');
    expect(dump).toContain('BANK-REF-ONLY');
    expect(dump).not.toContain('Invoice / payment ref.');
  });

  it('produces an FZCO-shape definition without a VAT row and with IBAN footer', () => {
    const invoice = parseInvoiceRow(fzcoInvoice001);
    const company = parseCompanyRow({
      ...uaeRow,
      iban: 'AE07 0331 2345 6789 0123 456',
      swift_bic: 'EBILAEAD',
    });
    const client = parseClientRow(LA_FOSSE_CLIENT_ROW);

    const dd = buildInvoiceDocDefinition(invoice, company, client);
    const dump = JSON.stringify(dd);

    expect(dump).toContain('Autonize IT Software Development – FZCO');
    expect(dump).toContain('La Fosse Associates Limited');
    expect(dump).not.toContain('VAT (');
    expect(dump).toContain('IBAN: AE07 0331 2345 6789 0123 456');
    expect(dump).toContain('SWIFT/BIC: EBILAEAD');
    expect(dump).not.toContain('Sort code');
    expect(dump).toContain('02/03/26\u201331/03/26');
  });
});

import { describe, it, expect } from 'vitest';
import {
  invoiceIdPrefixFor,
  nextInvoiceIdForEntity,
  nextSupplierInvoiceId,
} from './next-invoice-id.js';
import { parseInvoiceRow } from './csv-io.js';
import { dcInvoice001, dcInvoice002, fzcoInvoice001 } from './test-helpers.js';
import { parseClientRow } from '../clients/csv-io.js';
import { directRow, agencyRow } from '../clients/test-helpers.js';
import { makeTestCompanyRegistry } from '../company/fixtures.js';
import { companyById } from '../company/queries.js';
import type { Company } from '../company/schema.js';

const companyReg = makeTestCompanyRegistry();
const ukCompany = companyById('autonize-it-ltd', companyReg) as Company;
const fzcoCompany = companyById('autonize-it-fzco', companyReg) as Company;
const deltaCapita = parseClientRow(directRow);
const laFosse = parseClientRow(agencyRow);

function ukRowFromDcFixture(
  row: typeof dcInvoice001,
  ukId: string,
): ReturnType<typeof parseInvoiceRow> {
  return parseInvoiceRow({
    ...row,
    id: ukId,
    invoice_number: ukId,
    payment_reference: ukId,
  });
}

describe('invoiceIdPrefixFor', () => {
  it('returns UK for a UK-jurisdiction company', () => {
    expect(invoiceIdPrefixFor(ukCompany)).toBe('UK');
  });

  it('returns FZ for a UAE-jurisdiction company', () => {
    expect(invoiceIdPrefixFor(fzcoCompany)).toBe('FZ');
  });
});

describe('nextInvoiceIdForEntity', () => {
  it('returns UK-0001 for an empty list', () => {
    expect(nextInvoiceIdForEntity('autonize-it-ltd', ukCompany, [])).toBe('UK-0001');
  });

  it('returns FZ-0001 for an empty list under the FZCO entity', () => {
    expect(nextInvoiceIdForEntity('autonize-it-fzco', fzcoCompany, [])).toBe('FZ-0001');
  });

  it('returns max+1 not count+1 for UK-#### (preserves gaps)', () => {
    const gappy = [
      ukRowFromDcFixture(dcInvoice001, 'UK-0001'),
      ukRowFromDcFixture(dcInvoice002, 'UK-0005'),
    ];
    expect(nextInvoiceIdForEntity('autonize-it-ltd', ukCompany, gappy)).toBe('UK-0006');
  });

  it('counts only UK-#### ids for the UK entity (ignores DC- rows)', () => {
    const mixed = [dcInvoice001, dcInvoice002, fzcoInvoice001].map(parseInvoiceRow);
    expect(nextInvoiceIdForEntity('autonize-it-ltd', ukCompany, mixed)).toBe('UK-0001');
    expect(nextInvoiceIdForEntity('autonize-it-fzco', fzcoCompany, mixed)).toBe('FZ-0002');
  });

  it('jumps to the correct next slot when only a high id exists', () => {
    const row = parseInvoiceRow({
      ...dcInvoice001,
      id: 'UK-0099',
      invoice_number: 'UK-0099',
      payment_reference: 'UK-0099',
    });
    expect(nextInvoiceIdForEntity('autonize-it-ltd', ukCompany, [row])).toBe('UK-0100');
  });
});

describe('nextSupplierInvoiceId', () => {
  it('returns DC-001 when no Delta invoices exist', () => {
    expect(
      nextSupplierInvoiceId(deltaCapita, ukCompany, 'autonize-it-ltd', []),
    ).toBe('DC-001');
  });

  it('returns next DC when Delta rows use DC ids', () => {
    const rows = [dcInvoice001, dcInvoice002].map(parseInvoiceRow);
    expect(
      nextSupplierInvoiceId(deltaCapita, ukCompany, 'autonize-it-ltd', rows),
    ).toBe('DC-003');
  });

  it('returns UK-0001 for a non–Delta Capita client on UK Ltd', () => {
    expect(
      nextSupplierInvoiceId(laFosse, ukCompany, 'autonize-it-ltd', []),
    ).toBe('UK-0001');
  });

  it('returns FZ-0001 for La Fosse on FZCO', () => {
    expect(
      nextSupplierInvoiceId(laFosse, fzcoCompany, 'autonize-it-fzco', []),
    ).toBe('FZ-0001');
  });
});

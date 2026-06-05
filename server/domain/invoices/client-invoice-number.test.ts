import { describe, it, expect } from 'vitest';
import { parseInvoiceRow } from './csv-io.js';
import { dcInvoice001, dcInvoice002 } from './test-helpers.js';
import {
  nextDeltaCapitaInvoiceId,
  nextDeltaCapitaInvoiceNumber,
  nextLaFosseInvoiceId,
  nextLaFosseInvoiceNumber,
} from './client-invoice-number.js';

describe('nextDeltaCapitaInvoiceNumber', () => {
  it('returns DC-001 when no Delta rows exist', () => {
    expect(nextDeltaCapitaInvoiceNumber([])).toBe('DC-001');
  });

  it('returns max DC + 1 from invoice_number on the same client', () => {
    const rows = [dcInvoice001, dcInvoice002].map(parseInvoiceRow);
    expect(nextDeltaCapitaInvoiceNumber(rows)).toBe('DC-003');
  });

  it('uses id when it carries the DC sequence', () => {
    const dc = parseInvoiceRow(dcInvoice001);
    const bumped = { ...dc, id: 'DC-099' as const, invoice_number: 'DC-001' };
    expect(nextDeltaCapitaInvoiceNumber([bumped])).toBe('DC-100');
  });

  it('ignores rows for other clients', () => {
    const dc = parseInvoiceRow(dcInvoice001);
    const otherClient = { ...dc, client_id: 'la-fosse' as const };
    expect(nextDeltaCapitaInvoiceNumber([dc, otherClient])).toBe('DC-002');
  });
});

describe('nextDeltaCapitaInvoiceId', () => {
  it('returns the same string as the number helper', () => {
    expect(nextDeltaCapitaInvoiceId([])).toBe('DC-001');
  });
});

describe('nextLaFosseInvoiceNumber', () => {
  it('returns EG-0001 when no La Fosse rows exist', () => {
    expect(nextLaFosseInvoiceNumber([])).toBe('EG-0001');
  });

  it('returns max EG + 1 from la-fosse rows', () => {
    const dc = parseInvoiceRow(dcInvoice001);
    const lf = {
      ...dc,
      client_id: 'la-fosse' as const,
      id: 'EG-0064' as const,
      invoice_number: 'EG-0064',
    };
    expect(nextLaFosseInvoiceNumber([lf])).toBe('EG-0065');
  });

  it('ignores Delta Capita rows', () => {
    const dc = parseInvoiceRow(dcInvoice001);
    expect(nextLaFosseInvoiceNumber([dc])).toBe('EG-0001');
  });
});

describe('nextLaFosseInvoiceId', () => {
  it('returns the same string as the number helper', () => {
    expect(nextLaFosseInvoiceId([])).toBe('EG-0001');
  });
});

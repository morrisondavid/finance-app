import { describe, it, expect } from 'vitest';
import { parseInvoiceRow } from './csv-io.js';
import { dcInvoice001, rowFromHeaders } from './test-helpers.js';
import {
  buildReferenceIndex,
  compactReference,
  extractNarrativeReferenceKeys,
  findReferencedInvoices,
  referenceIndexKeys,
} from './reference-match.js';

function laFosseInvoice(
  id: string,
  paymentReference: string,
  total: string,
): ReturnType<typeof parseInvoiceRow> {
  return parseInvoiceRow(
    rowFromHeaders({
      id,
      contract_id: 'lf-bh28240',
      client_id: 'la-fosse',
      issuing_entity_id: 'autonize-it-ltd',
      invoice_number: id,
      payment_reference: paymentReference,
      invoice_date: '2025-11-26',
      period_start: '2025-11-10',
      period_end: '2025-11-16',
      days_billed: '3',
      description: 'David Morrison - Consultant Services, Full Stack Engineer',
      currency: 'GBP',
      subtotal: String(Number(total) / 1.2),
      vat_rate: '0.2',
      vat_amount: String(Number(total) - Number(total) / 1.2),
      total,
      mechanism: 'self-bill',
      status: 'issued',
      due_date: '2025-12-26',
      created_at: '2025-11-26',
      updated_at: '2025-11-26',
    }),
  );
}

describe('compactReference', () => {
  it('normalises hyphens and spaces', () => {
    expect(compactReference('SB-280052')).toBe('SB280052');
    expect(compactReference('EG-0038')).toBe('EG0038');
    expect(compactReference('SB 280052')).toBe('SB280052');
  });
});

describe('extractNarrativeReferenceKeys', () => {
  it('extracts SB refs from whitespace-compacted Emirates narratives', () => {
    const keys = extractNarrativeReferenceKeys(
      'INWARD REMITTANCE /INV/SB-298459SB-298461/INV/SB-2984 64SB-298460/INV/SB-298463',
    );
    expect(keys).toContain('SB298464');
    expect(keys).toContain('SB298459');
    expect(keys).toContain('SB298460');
  });
});

describe('findReferencedInvoices — boundary safety', () => {
  it('matches SB-280052 exactly without matching SB-280053', () => {
    const invoices = [
      laFosseInvoice('EG-0038', 'SB-280052', '1800'),
      laFosseInvoice('EG-0039', 'SB-280053', '3000'),
    ];
    const index = buildReferenceIndex(invoices);
    const sorted = referenceIndexKeys(index);

    const hit = findReferencedInvoices(
      'LA FOSSE LTD SB-280052 PAYMENT',
      index,
      sorted,
    );
    expect(hit.kind).toBe('hits');
    if (hit.kind !== 'hits') return;
    expect(hit.invoices.map(inv => inv.id)).toEqual(['EG-0038']);
  });

  it('skips truncated SB-28005 when it is a prefix of multiple references', () => {
    const invoices = [
      laFosseInvoice('EG-0038', 'SB-280052', '1800'),
      laFosseInvoice('EG-0039', 'SB-280053', '3000'),
    ];
    const index = buildReferenceIndex(invoices);
    const sorted = referenceIndexKeys(index);

    const result = findReferencedInvoices('LA FOSSE SB-28005', index, sorted);
    expect(result.kind).toBe('none');
  });

  it('resolves a unique prefix extension when only one index key matches', () => {
    const invoices = [laFosseInvoice('EG-0038', 'SB-280052', '1800')];
    const index = buildReferenceIndex(invoices);
    const sorted = referenceIndexKeys(index);

    const result = findReferencedInvoices('LA FOSSE SB-28005', index, sorted);
    expect(result.kind).toBe('hits');
    if (result.kind !== 'hits') return;
    expect(result.invoices.map(inv => inv.id)).toEqual(['EG-0038']);
  });
});

describe('buildReferenceIndex', () => {
  it('indexes both payment_reference and invoice_number', () => {
    const index = buildReferenceIndex([parseInvoiceRow(dcInvoice001)]);
    expect(index.get('DC001')).toHaveLength(1);
  });
});

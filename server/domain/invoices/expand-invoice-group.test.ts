import { describe, it, expect } from 'vitest';
import { parseInvoiceRow } from './csv-io.js';
import { rowFromHeaders } from './test-helpers.js';
import { resolveExpandedInvoiceGroup } from './expand-invoice-group.js';

function invoice(id: string, total: string, periodStart: string) {
  const totalNum = Number(total);
  const subtotal = totalNum / 1.2;
  return parseInvoiceRow(
    rowFromHeaders({
      id,
      contract_id: 'lf-bh28240',
      client_id: 'la-fosse',
      issuing_entity_id: 'autonize-it-ltd',
      invoice_number: id,
      payment_reference: `SB-${id.replace('EG-', '')}`,
      invoice_date: '2025-11-26',
      period_start: periodStart,
      period_end: periodStart,
      days_billed: '3',
      description: 'David Morrison - Consultant Services, Full Stack Engineer',
      currency: 'GBP',
      subtotal: String(subtotal),
      vat_rate: '0.2',
      vat_amount: String(totalNum - subtotal),
      total,
      mechanism: 'self-bill',
      status: 'issued',
      due_date: '2025-12-26',
      created_at: '2025-11-26',
      updated_at: '2025-11-26',
    }),
  );
}

describe('resolveExpandedInvoiceGroup', () => {
  it('returns ambiguous when more than one subset matches the deposit', () => {
    const invA = invoice('EG-8001', '2000', '2025-10-01');
    const invB = invoice('EG-8002', '1000', '2025-10-08');
    const invC = invoice('EG-8003', '500', '2025-10-15');
    const invD = invoice('EG-8004', '1500', '2025-10-22');

    const result = resolveExpandedInvoiceGroup({
      seed: [invB],
      pool: [invA, invB, invC, invD],
      targetAmount: 2000,
    });

    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.detail).toContain('Multiple invoice combinations');
    }
  });

  it('matches exactly to the penny — no fractional tolerance', () => {
    const invA = invoice('EG-9001', '2000', '2025-10-01');
    const invB = invoice('EG-9002', '1000', '2025-10-08');

    // 2950 is within 2% of 3000 but must NOT match.
    const nearMiss = resolveExpandedInvoiceGroup({
      seed: [invA],
      pool: [invA, invB],
      targetAmount: 2950,
    });
    expect(nearMiss.kind).toBe('no-match');

    const exact = resolveExpandedInvoiceGroup({
      seed: [invA],
      pool: [invA, invB],
      targetAmount: 3000,
    });
    expect(exact.kind).toBe('exact');
    if (exact.kind === 'exact') {
      expect(new Set(exact.invoices.map(i => i.id))).toEqual(new Set(['EG-9001', 'EG-9002']));
    }
  });
});

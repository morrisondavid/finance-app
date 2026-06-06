import { describe, it, expect } from 'vitest';
import type { Invoice } from './schema.js';
import { previewFingerprintForMonthlyInvoiceDraft } from './monthly-invoice-fingerprint.js';

const MINIMAL_ISSUABLE_ROW: Invoice = {
  id: 'X',
  contract_id: 'c1',
  client_id: 'cl1',
  issuing_entity_id: 'autonize-it-ltd',
  invoice_number: 'N',
  payment_reference: 'N',
  invoice_date: '2026-04-01',
  period_start: '2026-04-01',
  period_end: '2026-04-30',
  days_billed: 21,
  description: 'd',
  currency: 'GBP',
  subtotal: 100,
  vat_rate: 0.2,
  vat_amount: 20,
  total: 120,
  fx_rate_at_issue: null,
  fx_base_currency: null,
  mechanism: 'supplier-issued',
  status: 'draft',
  due_date: '2026-05-01',
  created_at: '2026-04-01',
  updated_at: null,
};

describe('previewFingerprintForMonthlyInvoiceDraft', () => {
  it('stable for identical eligible fields ignoring line edits tracked elsewhere', () => {
    const a = MINIMAL_ISSUABLE_ROW;
    const b: Invoice = { ...MINIMAL_ISSUABLE_ROW, days_billed: 22, description: 'other' };
    expect(previewFingerprintForMonthlyInvoiceDraft(a)).toBe(previewFingerprintForMonthlyInvoiceDraft(b));
  });

  it('changes when issuing entity changes', () => {
    const a = MINIMAL_ISSUABLE_ROW;
    const b: Invoice = { ...MINIMAL_ISSUABLE_ROW, issuing_entity_id: 'autonize-it-fzco' };
    expect(previewFingerprintForMonthlyInvoiceDraft(a)).not.toBe(
      previewFingerprintForMonthlyInvoiceDraft(b),
    );
  });
});

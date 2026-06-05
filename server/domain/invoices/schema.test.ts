/**
 * Zod-level invariants for the Invoice schemas.
 *
 * Deliberately narrow: structural validation only (id format, date
 * format, non-negative amounts, enum variants). Business-level
 * invariants (period_start <= period_end, due-date year typos) are
 * NOT enforced here — those are flagged at read time by the Phase 4
 * reconciler where needed. Keeping the schema permissive is what
 * lets historical fixtures load cleanly.
 */

import { describe, it, expect } from 'vitest';
import {
  InvoiceIdSchema,
  InvoiceSchema,
  InvoiceStatusSchema,
  InvoiceMechanismSchema,
  InvoicePaymentSchema,
} from './schema.js';

const validInvoice = {
  id: 'DC-001',
  contract_id: 'dc-sow-2025-jun',
  client_id: 'delta-capita',
  issuing_entity_id: 'autonize-it-ltd' as const,
  invoice_number: 'DC-001',
  payment_reference: 'DC-001',
  invoice_date: '2025-07-09',
  period_start: '2025-06-23',
  period_end: '2025-06-30',
  days_billed: 6,
  description: 'David Morrison - Consultant Services, Software Development',
  currency: 'GBP' as const,
  subtotal: 3300,
  vat_rate: 0.2,
  vat_amount: 660,
  total: 3960,
  fx_rate_at_issue: null,
  fx_base_currency: null,
  mechanism: 'supplier-issued' as const,
  pdf_path: null,
  status: 'paid' as const,
  due_date: '2025-08-09',
  created_at: '2025-07-09',
  updated_at: '2025-07-09',
};

describe('InvoiceIdSchema', () => {
  it('accepts UK-####', () => {
    expect(InvoiceIdSchema.parse('UK-0001')).toBe('UK-0001');
  });

  it('accepts FZ-####', () => {
    expect(InvoiceIdSchema.parse('FZ-0042')).toBe('FZ-0042');
  });

  it('accepts DC-### (Delta Capita series)', () => {
    expect(InvoiceIdSchema.parse('DC-001')).toBe('DC-001');
    expect(InvoiceIdSchema.parse('DC-100')).toBe('DC-100');
  });

  it('accepts EG-#### (La Fosse / Edwin Group series)', () => {
    expect(InvoiceIdSchema.parse('EG-0001')).toBe('EG-0001');
    expect(InvoiceIdSchema.parse('EG-0052')).toBe('EG-0052');
  });

  it('rejects unknown entity prefix', () => {
    expect(() => InvoiceIdSchema.parse('XX-0001')).toThrow();
  });

  it('rejects non-4-digit UK sequence', () => {
    expect(() => InvoiceIdSchema.parse('UK-1')).toThrow();
    expect(() => InvoiceIdSchema.parse('UK-00001')).toThrow();
  });

  it('rejects DC ids that are not exactly three trailing digits', () => {
    expect(() => InvoiceIdSchema.parse('DC-1')).toThrow();
    expect(() => InvoiceIdSchema.parse('DC-00001')).toThrow();
  });

  it('rejects missing dash', () => {
    expect(() => InvoiceIdSchema.parse('UK0001')).toThrow();
  });
});

describe('InvoiceStatusSchema', () => {
  it('accepts the four stored statuses', () => {
    for (const s of ['draft', 'issued', 'paid', 'partial']) {
      expect(InvoiceStatusSchema.parse(s)).toBe(s);
    }
  });

  it('does NOT accept overdue (derived at read time, never stored)', () => {
    expect(() => InvoiceStatusSchema.parse('overdue')).toThrow();
  });
});

describe('InvoiceMechanismSchema', () => {
  it('accepts supplier-issued and self-bill', () => {
    expect(InvoiceMechanismSchema.parse('supplier-issued')).toBe('supplier-issued');
    expect(InvoiceMechanismSchema.parse('self-bill')).toBe('self-bill');
  });

  it('rejects anything else', () => {
    expect(() => InvoiceMechanismSchema.parse('unknown')).toThrow();
  });
});

describe('InvoiceSchema', () => {
  it('accepts a canonical valid invoice', () => {
    expect(InvoiceSchema.parse(validInvoice).id).toBe('DC-001');
  });

  it('rejects negative days_billed', () => {
    expect(() => InvoiceSchema.parse({ ...validInvoice, days_billed: -1 })).toThrow();
  });

  it('rejects negative subtotal / total', () => {
    expect(() => InvoiceSchema.parse({ ...validInvoice, subtotal: -100 })).toThrow();
    expect(() => InvoiceSchema.parse({ ...validInvoice, total: -10 })).toThrow();
  });

  it('allows pdf_path to be null (historical rows with no stored PDF)', () => {
    expect(InvoiceSchema.parse({ ...validInvoice, pdf_path: null }).pdf_path).toBeNull();
  });

  it('allows nullable updated_at', () => {
    expect(InvoiceSchema.parse({ ...validInvoice, updated_at: null }).updated_at).toBeNull();
  });

  it('does NOT enforce that period_start <= period_end (reconciler concern)', () => {
    // The historical DC-0008 row has a wildly-wrong period; the
    // schema must still accept it so the reconciler can surface the
    // problem. Locking this explicitly in a test prevents a well-
    // meaning future contributor from adding a `.refine()`.
    const row = { ...validInvoice, period_start: '2025-12-30', period_end: '2025-01-05' };
    expect(InvoiceSchema.parse(row).period_end).toBe('2025-01-05');
  });

  it('rejects malformed dates', () => {
    expect(() => InvoiceSchema.parse({ ...validInvoice, invoice_date: '2025/07/09' })).toThrow();
  });
});

describe('InvoicePaymentSchema', () => {
  const validPayment = {
    id: 'PMT-0001',
    invoice_id: 'DC-001',
    bank_transaction_id: 'txn-123',
    payment_date: '2025-08-05',
    amount_paid: 3960,
    deposit_currency: 'GBP' as const,
    fx_rate_at_payment: null,
    amount_in_invoice_currency: 3960,
    fx_gain_loss: 0,
    residual: 0,
    created_at: '2025-08-05',
    updated_at: null,
  };

  it('accepts a canonical payment', () => {
    expect(InvoicePaymentSchema.parse(validPayment).residual).toBe(0);
  });

  it('allows fx_gain_loss to be negative', () => {
    expect(InvoicePaymentSchema.parse({ ...validPayment, fx_gain_loss: -42 }).fx_gain_loss).toBe(-42);
  });

  it('rejects negative amount_paid', () => {
    expect(() => InvoicePaymentSchema.parse({ ...validPayment, amount_paid: -1 })).toThrow();
  });

  it('rejects non-positive fx_rate_at_payment when set', () => {
    expect(() => InvoicePaymentSchema.parse({ ...validPayment, fx_rate_at_payment: 0 })).toThrow();
  });
});

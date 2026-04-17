import { describe, it, expect } from 'vitest';
import { toApiObligation } from './obligations.js';

describe('obligations repository', () => {
  describe('toApiObligation', () => {
    it('maps snake_case DB row to camelCase API shape', () => {
      const row = {
        id: 'test-1',
        source: 'manual',
        type: 'vat',
        name: 'VAT Q1',
        entity: 'HMRC',
        recurrence: 'quarterly',
        expected_amount: 5000,
        due_date: '2025-03-07',
        status: 'pending',
        paid_amount: null,
        paid_date: null,
        paid_from_account: null,
        notes: 'test notes',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      };
      const result = toApiObligation(row);
      expect(result.id).toBe('test-1');
      expect(result.source).toBe('manual');
      expect(result.expectedAmount).toBe(5000);
      expect(result.dueDate).toBe('2025-03-07');
      expect(result.paidAmount).toBeNull();
      expect(result.paidFromAccount).toBeNull();
      expect(result.notes).toBe('test notes');
      expect(result.createdAt).toBe('2025-01-01');
    });

    it('maps auto-derived obligation with payment info', () => {
      const row = {
        id: 'auto-vat-2025-02-01',
        source: 'auto',
        type: 'vat',
        name: 'VAT Feb-Apr 2025',
        entity: 'HMRC',
        recurrence: 'quarterly',
        expected_amount: 1000,
        due_date: '2025-06-07',
        status: 'paid',
        paid_amount: 1000,
        paid_date: '2025-06-01',
        paid_from_account: 'barclays-current',
        notes: null,
        created_at: '2025-06-15',
        updated_at: '2025-06-15',
      };
      const result = toApiObligation(row);
      expect(result.source).toBe('auto');
      expect(result.paidAmount).toBe(1000);
      expect(result.paidFromAccount).toBe('barclays-current');
      expect(result.status).toBe('paid');
    });

    it('preserves null fields', () => {
      const row = {
        id: 'test-2',
        source: 'manual',
        type: 'other',
        name: 'Test',
        entity: 'Entity',
        recurrence: 'one-off',
        expected_amount: null,
        due_date: null,
        status: 'pending',
        paid_amount: null,
        paid_date: null,
        paid_from_account: null,
        notes: null,
        created_at: null,
        updated_at: null,
      };
      const result = toApiObligation(row);
      expect(result.expectedAmount).toBeNull();
      expect(result.dueDate).toBeNull();
      expect(result.paidAmount).toBeNull();
      expect(result.paidDate).toBeNull();
      expect(result.paidFromAccount).toBeNull();
      expect(result.notes).toBeNull();
      expect(result.createdAt).toBeNull();
      expect(result.updatedAt).toBeNull();
    });
  });
});

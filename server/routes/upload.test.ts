import { describe, it, expect } from 'vitest';
import { evaluateUploadAcceptance } from './upload.js';

/**
 * Route-level regression tests for the generic upload pipeline.
 *
 * These tests assert that no account-specific strings leak back into the
 * filter: `.xls` must only be accepted when the selected parser has opted
 * into it via `acceptedUploadExtensions`.
 */
describe('evaluateUploadAcceptance', () => {
  describe('CSV lane', () => {
    it('accepts .csv for every statements account', () => {
      expect(evaluateUploadAcceptance('2025-03_transactions.csv', 'barclays-current', 'csv'))
        .toEqual({ accepted: true });
      expect(evaluateUploadAcceptance('2025-03_transactions.csv', 'santander-everyday', 'csv'))
        .toEqual({ accepted: true });
    });

    it('rejects .xls for an account whose parser has not opted in', () => {
      const result = evaluateUploadAcceptance('Report_2042026.xls', 'barclays-current', 'csv');
      expect(result.accepted).toBe(false);
      if (!result.accepted) {
        expect(result.reason).toMatch(/Invalid file type/i);
      }
    });

    it('accepts .xls only when the parser declares it in acceptedUploadExtensions', () => {
      // Santander's parser declares `.xls`; no account name appears in the
      // route's decision function, so this must work purely through the
      // capability lookup.
      expect(evaluateUploadAcceptance('Report_2042026.xls', 'santander-everyday', 'csv'))
        .toEqual({ accepted: true });
    });

    it('rejects arbitrary extensions regardless of account', () => {
      expect(evaluateUploadAcceptance('statement.txt', 'barclays-current', 'csv').accepted).toBe(false);
      expect(evaluateUploadAcceptance('statement.txt', 'santander-everyday', 'csv').accepted).toBe(false);
      expect(evaluateUploadAcceptance('statement.json', 'santander-everyday', 'csv').accepted).toBe(false);
    });

    it('is case-insensitive on the extension', () => {
      expect(evaluateUploadAcceptance('Report_2042026.XLS', 'santander-everyday', 'csv'))
        .toEqual({ accepted: true });
      expect(evaluateUploadAcceptance('2025-03_transactions.CSV', 'barclays-current', 'csv'))
        .toEqual({ accepted: true });
    });
  });

  describe('PDF lane', () => {
    it('accepts .pdf for statements', () => {
      expect(evaluateUploadAcceptance('2025-03_statement.pdf', 'barclays-current', 'pdf'))
        .toEqual({ accepted: true });
    });

    it('rejects a .pdf on the csv lane and a .csv on the pdf lane', () => {
      expect(evaluateUploadAcceptance('x.pdf', 'barclays-current', 'csv').accepted).toBe(false);
      expect(evaluateUploadAcceptance('x.csv', 'barclays-current', 'pdf').accepted).toBe(false);
    });
  });

  describe('Invoices', () => {
    it('accepts .pdf', () => {
      expect(evaluateUploadAcceptance('invoice.pdf', 'invoices', 'pdf'))
        .toEqual({ accepted: true });
    });

    it('rejects anything else with an invoices-specific error', () => {
      const result = evaluateUploadAcceptance('invoice.csv', 'invoices', 'pdf');
      expect(result.accepted).toBe(false);
      if (!result.accepted) {
        expect(result.reason).toMatch(/Invoices must be PDF/);
      }
    });
  });

  describe('Unknown accounts', () => {
    it('rejects an unknown account even for .csv', () => {
      const result = evaluateUploadAcceptance('x.xls', 'not-a-real-bank', 'csv');
      expect(result.accepted).toBe(false);
    });
  });
});

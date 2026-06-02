import { describe, expect, it } from 'vitest';
import { getReportingManifest } from './reporting-manifest.js';

describe('getReportingManifest', () => {
  it('UK Ltd VAT requires 5 accounts with PDF and CSV for each', () => {
    const manifest = getReportingManifest('autonize-it-ltd', 'vat');
    expect(manifest.accounts).toHaveLength(5);
    for (const account of manifest.accounts) {
      expect(manifest.docTypesByAccount.get(account)).toEqual(['pdf', 'csv']);
    }
    expect(manifest.requiresInvoices).toBe(true);
    expect(manifest.graceDays).toBe(7);
  });

  it('FZCO requires 3 Emirates accounts and no invoices', () => {
    const manifest = getReportingManifest('autonize-it-fzco', 'vat');
    expect(manifest.accounts).toHaveLength(3);
    expect(manifest.accounts.every(a => a.startsWith('emirates-'))).toBe(true);
    expect(manifest.requiresInvoices).toBe(false);
  });
});

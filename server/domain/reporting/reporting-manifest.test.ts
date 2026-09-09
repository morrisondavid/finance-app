import { describe, expect, it } from 'vitest';
import { getReportingManifest } from './reporting-manifest.js';

describe('getReportingManifest', () => {
  it('UK Ltd VAT requires 5 accounts; wise-ltd CSV-only, others PDF+CSV', () => {
    const manifest = getReportingManifest('autonize-it-ltd', 'vat');
    expect(manifest.accounts).toHaveLength(5);
    expect(manifest.docTypesByAccount.get('wise-ltd')).toEqual(['csv']);
    for (const account of manifest.accounts) {
      if (account === 'wise-ltd') continue;
      expect(manifest.docTypesByAccount.get(account)).toEqual(['pdf', 'csv']);
    }
    expect(manifest.requiresInvoices).toBe(true);
    expect(manifest.graceDays).toBe(7);
  });

  it('UK Ltd date range requires invoices like VAT and CT', () => {
    const manifest = getReportingManifest('autonize-it-ltd', 'date_range');
    expect(manifest.requiresInvoices).toBe(true);
    expect(manifest.accounts).toHaveLength(5);
  });

  it('FZCO requires 3 Emirates accounts and no invoices', () => {
    const manifest = getReportingManifest('autonize-it-fzco', 'vat');
    expect(manifest.accounts).toHaveLength(3);
    expect(manifest.accounts.every(a => a.startsWith('emirates-'))).toBe(true);
    expect(manifest.requiresInvoices).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { formatMissingReadinessSummary } from './reporting-format.js';

describe('formatMissingReadinessSummary', () => {
  it('groups missing docs by account and appends invoice numbers', () => {
    const summary = formatMissingReadinessSummary(
      [
        {
          account: 'barclays-current',
          accountLabel: 'Barclays Current',
          monthKey: '2025-03',
          docType: 'pdf',
        },
        {
          account: 'barclaycard',
          accountLabel: 'Barclaycard',
          monthKey: '2025-02',
          docType: 'csv',
        },
      ],
      ['DC-011', 'DC-012'],
    );
    expect(summary).toContain('Barclays Current');
    expect(summary).toContain('PDF statement — Mar 2025');
    expect(summary).toContain('Barclaycard');
    expect(summary).toContain('Transaction CSV — Feb 2025');
    expect(summary).toContain('DC-011');
    expect(summary).toContain('DC-012');
  });

  it('returns empty string when nothing missing', () => {
    expect(formatMissingReadinessSummary([], [])).toBe('');
  });
});

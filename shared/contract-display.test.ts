import { describe, it, expect } from 'vitest';
import { contractDisplayName } from './contract-display.js';

describe('contractDisplayName', () => {
  it('uses trading_name and abbreviated-month date span', () => {
    expect(
      contractDisplayName(
        {
          client_id: 'c',
          start_date: '2026-01-01',
          end_date: '2026-04-30',
        },
        { trading_name: 'Delta Capita' },
      ),
    ).toBe('Delta Capita · 01 Jan 2026–30 Apr 2026');
  });

  it('falls back to client_id when client missing', () => {
    expect(
      contractDisplayName(
        { client_id: 'la-fosse', start_date: '2026-03-02', end_date: null },
        undefined,
      ),
    ).toBe('la-fosse · 02 Mar 2026–open-ended');
  });
});

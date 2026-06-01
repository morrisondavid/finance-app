import { describe, it, expect } from 'vitest';
import {
  contractDisplayName,
  isContractCurrent,
  isContractExpired,
  isContractUpcoming,
} from './contract-display.js';

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
        { client_id: 'la-fosse', start_date: '2026-03-02', end_date: '2026-04-30' },
        undefined,
      ),
    ).toBe('la-fosse · 02 Mar 2026–30 Apr 2026');
  });
});

describe('contract date helpers', () => {
  const contract = { start_date: '2026-01-01', end_date: '2026-04-30' };

  it('isContractCurrent', () => {
    expect(isContractCurrent(contract, '2026-02-15')).toBe(true);
    expect(isContractCurrent(contract, '2025-12-31')).toBe(false);
    expect(isContractCurrent(contract, '2026-05-01')).toBe(false);
  });

  it('isContractExpired', () => {
    expect(isContractExpired(contract, '2026-05-01')).toBe(true);
    expect(isContractExpired(contract, '2026-04-30')).toBe(false);
  });

  it('isContractUpcoming', () => {
    expect(isContractUpcoming(contract, '2025-12-31')).toBe(true);
    expect(isContractUpcoming(contract, '2026-01-01')).toBe(false);
  });
});

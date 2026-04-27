import { describe, it, expect } from 'vitest';
import { buildReserveRegistryFromData } from './registry.js';
import { allReserves, reserveForObligation } from './queries.js';
import type { Reserve } from './schema.js';

const fx: readonly Reserve[] = [
  {
    obligation_type: 'vat',
    entity_id: 'autonize-it-ltd',
    reserve_account: 'barclays-savings',
    notes: null,
    updated_at: '2026-01-01',
  },
];

describe('queries', () => {
  const reg = buildReserveRegistryFromData(fx);

  it('allReserves returns the full list', () => {
    expect(allReserves(reg)).toEqual(fx);
  });

  it('reserveForObligation returns the row for a known pair', () => {
    expect(reserveForObligation('vat', 'autonize-it-ltd', reg)?.reserve_account).toBe('barclays-savings');
  });

  it('reserveForObligation returns null for an unknown pair', () => {
    expect(reserveForObligation('vat', 'autonize-it-fzco', reg)).toBeNull();
    expect(reserveForObligation('hmrc-ttp', 'autonize-it-ltd', reg)).toBeNull();
  });
});

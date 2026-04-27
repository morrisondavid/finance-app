import { describe, it, expect } from 'vitest';
import { ReserveSchema, reserveKey } from './schema.js';

describe('ReserveSchema', () => {
  it('accepts a valid row', () => {
    expect(() =>
      ReserveSchema.parse({
        obligation_type: 'vat',
        entity_id: 'autonize-it-ltd',
        reserve_account: 'barclays-savings',
        notes: 'UK Ltd VAT',
        updated_at: '2026-04-25',
      }),
    ).not.toThrow();
  });

  it('rejects an unknown obligation_type', () => {
    expect(() =>
      ReserveSchema.parse({
        obligation_type: 'made-up',
        entity_id: 'autonize-it-ltd',
        reserve_account: 'barclays-savings',
        notes: null,
        updated_at: '2026-04-25',
      }),
    ).toThrow();
  });

  it('rejects an unknown account name', () => {
    expect(() =>
      ReserveSchema.parse({
        obligation_type: 'vat',
        entity_id: 'autonize-it-ltd',
        reserve_account: 'fake-bank',
        notes: null,
        updated_at: '2026-04-25',
      }),
    ).toThrow();
  });

  it('rejects a non-ISO updated_at', () => {
    expect(() =>
      ReserveSchema.parse({
        obligation_type: 'vat',
        entity_id: 'autonize-it-ltd',
        reserve_account: 'barclays-savings',
        notes: null,
        updated_at: '25-04-2026',
      }),
    ).toThrow();
  });
});

describe('reserveKey', () => {
  it('produces stable composite keys', () => {
    expect(reserveKey('vat', 'autonize-it-ltd')).toBe('vat::autonize-it-ltd');
    expect(reserveKey('corporation-tax', 'autonize-it-fzco')).toBe('corporation-tax::autonize-it-fzco');
  });
});

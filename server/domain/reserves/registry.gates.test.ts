import { describe, it, expect } from 'vitest';
import { buildReserveRegistryFromData } from './registry.js';
import { reserveKey, type Reserve } from './schema.js';

const fx: readonly Reserve[] = [
  {
    obligation_type: 'vat',
    entity_id: 'autonize-it-ltd',
    reserve_account: 'barclays-savings',
    notes: null,
    updated_at: '2026-01-01',
    lookahead_days: 90,
  },
  {
    obligation_type: 'vat',
    entity_id: 'autonize-it-fzco',
    reserve_account: 'emirates-islamic',
    notes: null,
    updated_at: '2026-02-01',
    lookahead_days: 90,
  },
];

describe('byKey composite-key index', () => {
  const reg = buildReserveRegistryFromData(fx);

  it('returns the row for a known (obligation_type, entity_id) pair', () => {
    const k = reserveKey('vat', 'autonize-it-ltd');
    expect(reg.indexes.byKey.get(k)?.reserve_account).toBe('barclays-savings');
  });

  it('returns the right row for the FZCO equivalent', () => {
    const k = reserveKey('vat', 'autonize-it-fzco');
    expect(reg.indexes.byKey.get(k)?.reserve_account).toBe('emirates-islamic');
  });

  it('returns undefined for an unknown pair', () => {
    expect(reg.indexes.byKey.get(reserveKey('hmrc-ttp', 'autonize-it-ltd'))).toBeUndefined();
  });

  it('throws on duplicate composite keys at build time', () => {
    const dup: readonly Reserve[] = [fx[0], { ...fx[0] }];
    expect(() => buildReserveRegistryFromData(dup)).toThrow();
  });
});

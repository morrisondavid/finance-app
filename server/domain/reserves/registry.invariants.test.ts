import { describe, it, expect } from 'vitest';
import { buildReserveRegistry } from './registry.js';
import { reserveKey } from './schema.js';

const reg = buildReserveRegistry();

describe('reserves registry — coverage', () => {
  it('byKey covers every entry in `all`', () => {
    for (const r of reg.all) {
      expect(reg.indexes.byKey.get(reserveKey(r.obligation_type, r.entity_id))).toBeDefined();
    }
  });

  it('seed includes both UK Ltd and FZCO VAT rows', () => {
    expect(reg.indexes.byKey.get(reserveKey('vat', 'autonize-it-ltd'))).toBeDefined();
    expect(reg.indexes.byKey.get(reserveKey('vat', 'autonize-it-fzco'))).toBeDefined();
  });

  it('seed includes UK Ltd corporation-tax', () => {
    expect(reg.indexes.byKey.get(reserveKey('corporation-tax', 'autonize-it-ltd'))).toBeDefined();
  });
});

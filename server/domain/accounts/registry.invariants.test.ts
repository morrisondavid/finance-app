import { describe, it, expect } from 'vitest';
import { buildAccountsRegistry } from './registry.js';
import { ACCOUNT_CONFIG_DATA } from './data.js';

const reg = buildAccountsRegistry(ACCOUNT_CONFIG_DATA);

describe('registry invariants — every account appears somewhere', () => {
  it('byName covers every entry in all', () => {
    for (const a of reg.all) {
      expect(reg.byName.get(a.name)).toBeDefined();
    }
  });

  it('allNames length matches all length', () => {
    expect(reg.allNames.length).toBe(reg.all.length);
  });

  it('business ∪ personal === byName.keys() (partition)', () => {
    const union = new Set([...reg.indexes.business, ...reg.indexes.personal]);
    const allKeys = new Set(reg.byName.keys());
    expect(union.size).toBe(allKeys.size);
    for (const k of allKeys) {
      expect(union.has(k)).toBe(true);
    }
  });

  it('business ∩ personal === ∅ (disjoint)', () => {
    for (const a of reg.indexes.business) {
      expect(reg.indexes.personal).not.toContain(a);
    }
  });
});

describe('registry invariants — index containment', () => {
  it('vatApplicable ⊂ business', () => {
    for (const a of reg.indexes.vatApplicable) {
      expect(reg.indexes.business).toContain(a);
    }
  });

  it('corpTaxApplicable ⊂ business', () => {
    for (const a of reg.indexes.corpTaxApplicable) {
      expect(reg.indexes.business).toContain(a);
    }
  });

  it('businessOutgoingPayments ⊂ business ∩ outgoingPaymentsCapable', () => {
    for (const a of reg.indexes.businessOutgoingPayments) {
      expect(reg.indexes.business).toContain(a);
      expect(reg.indexes.outgoingPaymentsCapable).toContain(a);
    }
  });

  it('personalOutgoingPayments ⊂ personal ∩ outgoingPaymentsCapable', () => {
    for (const a of reg.indexes.personalOutgoingPayments) {
      expect(reg.indexes.personal).toContain(a);
      expect(reg.indexes.outgoingPaymentsCapable).toContain(a);
    }
  });

  it('outgoingPaymentsCapable === businessOutgoingPayments ∪ personalOutgoingPayments', () => {
    const union = new Set([
      ...reg.indexes.businessOutgoingPayments,
      ...reg.indexes.personalOutgoingPayments,
    ]);
    const full = new Set(reg.indexes.outgoingPaymentsCapable);
    expect(union.size).toBe(full.size);
    for (const a of full) {
      expect(union.has(a)).toBe(true);
    }
  });
});

describe('registry invariants — byEntity coherence', () => {
  it('every name in byEntity lists is a business account', () => {
    for (const [, names] of reg.indexes.byEntity) {
      for (const n of names) {
        expect(reg.indexes.business).toContain(n);
      }
    }
  });

  it('business === flatten(byEntity) (every business account has an entity)', () => {
    const fromByEntity = new Set<string>();
    for (const [, names] of reg.indexes.byEntity) {
      for (const n of names) fromByEntity.add(n);
    }
    expect(fromByEntity.size).toBe(reg.indexes.business.length);
    for (const b of reg.indexes.business) {
      expect(fromByEntity.has(b)).toBe(true);
    }
  });
});

describe('registry invariants — per-entity sub-indexes ⊂ entity', () => {
  it('vatApplicableByEntity[id] ⊂ byEntity[id]', () => {
    for (const [entityId, names] of reg.indexes.vatApplicableByEntity) {
      const entityAccounts = reg.indexes.byEntity.get(entityId) ?? [];
      for (const n of names) {
        expect(entityAccounts).toContain(n);
      }
    }
  });

  it('corpTaxApplicableByEntity[id] ⊂ byEntity[id]', () => {
    for (const [entityId, names] of reg.indexes.corpTaxApplicableByEntity) {
      const entityAccounts = reg.indexes.byEntity.get(entityId) ?? [];
      for (const n of names) {
        expect(entityAccounts).toContain(n);
      }
    }
  });

  it('flatten(vatApplicableByEntity) === vatApplicable', () => {
    const flat = new Set<string>();
    for (const [, names] of reg.indexes.vatApplicableByEntity) {
      for (const n of names) flat.add(n);
    }
    expect(flat.size).toBe(reg.indexes.vatApplicable.length);
    for (const n of reg.indexes.vatApplicable) {
      expect(flat.has(n)).toBe(true);
    }
  });

  it('flatten(corpTaxApplicableByEntity) === corpTaxApplicable', () => {
    const flat = new Set<string>();
    for (const [, names] of reg.indexes.corpTaxApplicableByEntity) {
      for (const n of names) flat.add(n);
    }
    expect(flat.size).toBe(reg.indexes.corpTaxApplicable.length);
    for (const n of reg.indexes.corpTaxApplicable) {
      expect(flat.has(n)).toBe(true);
    }
  });
});

describe('registry invariants — entityId / category coherence', () => {
  it('every business account has a non-null entityId', () => {
    for (const name of reg.indexes.business) {
      const config = reg.byName.get(name);
      expect(config?.entityId).not.toBeNull();
    }
  });

  it('every personal account has entityId === null', () => {
    for (const name of reg.indexes.personal) {
      const config = reg.byName.get(name);
      expect(config?.entityId).toBeNull();
    }
  });
});

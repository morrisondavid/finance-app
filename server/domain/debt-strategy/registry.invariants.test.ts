import { describe, it, expect } from 'vitest';
import { buildPlanRegistry } from './registry.js';

const reg = buildPlanRegistry();

describe('Plans registry — coverage', () => {
  it('byId covers every entry in `all`', () => {
    for (const p of reg.all) {
      expect(reg.indexes.byId.get(p.id)).toBeDefined();
    }
  });

  it('every persisted plan has status ∈ {active, paused, completed} (never suggested)', () => {
    for (const p of reg.all) {
      expect(['active', 'paused', 'completed']).toContain(p.status);
    }
  });

  it('every pay-off-debt plan has a target_id', () => {
    for (const p of reg.all) {
      if (p.goal_type === 'pay-off-debt') {
        expect(p.target_id, `Plan ${p.id} is pay-off-debt but target_id is null`).not.toBeNull();
      }
    }
  });

  it('every save-for-target plan has a target_amount', () => {
    for (const p of reg.all) {
      if (p.goal_type === 'save-for-target') {
        expect(p.target_amount, `Plan ${p.id} is save-for-target but target_amount is null`).not.toBeNull();
      }
    }
  });
});

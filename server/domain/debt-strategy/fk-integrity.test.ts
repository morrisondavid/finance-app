/**
 * FK-integrity test: every movement's `plan_id` must resolve to a row
 * in the plans registry. This is the §1.9 equivalent of the
 * properties↔obligations FK test in §1.7.
 *
 * Runs against the seed data on disk. If the user adds a movement
 * with a stale plan_id, this fails at startup-time.
 */

import { describe, it, expect } from 'vitest';
import { buildPlanRegistry } from './registry.js';
import { buildMovementRegistry } from './movements-registry.js';

describe('debt-strategy FK integrity', () => {
  it('every movement.plan_id resolves to a plan id', () => {
    const plans = buildPlanRegistry();
    const movements = buildMovementRegistry();
    for (const m of movements.all) {
      expect(
        plans.indexes.byId.has(m.plan_id),
        `Movement ${m.id} references plan_id "${m.plan_id}" which does not exist in plans.csv`,
      ).toBe(true);
    }
  });

  it('every persisted plan that has movements has at least 1 movement (no orphan plans without standing orders)', () => {
    const plans = buildPlanRegistry();
    const movements = buildMovementRegistry();
    // Active plans should have at least one movement; paused / completed
    // may or may not. We only assert the active case.
    const activePlans = plans.indexes.byStatus.get('active') ?? [];
    for (const p of activePlans) {
      const movs = movements.indexes.byPlanId.get(p.id) ?? [];
      // It's allowed for a plan to have 0 movements briefly between
      // creation and activation, but for v1 the route always creates
      // movements at activation time. Document the expectation:
      expect(movs.length, `Active plan ${p.id} has no movements — route should have created them at activation`).toBeGreaterThan(0);
    }
  });
});

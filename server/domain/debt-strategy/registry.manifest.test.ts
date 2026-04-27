import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildPlanRegistry } from './registry.js';

describe('debt-strategy plans registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    const reg = buildPlanRegistry();
    assertManifestConsumers({
      registry: reg,
      consumers: {
        byId: [
          {
            file: 'server/domain/debt-strategy/queries.ts',
            functions: ['planById'],
          },
        ],
        byStatus: [
          {
            file: 'server/domain/debt-strategy/queries.ts',
            functions: ['plansByStatus', 'livePlans', 'activePlans', 'completedPlans', 'pausedPlans'],
          },
        ],
        byGoalType: [
          {
            file: 'server/domain/debt-strategy/queries.ts',
            functions: ['plansByGoalType'],
          },
        ],
        byTargetId: [
          {
            file: 'server/domain/debt-strategy/queries.ts',
            functions: ['plansByTargetId'],
          },
        ],
      },
    });
  });
});

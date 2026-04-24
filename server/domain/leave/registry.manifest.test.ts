/**
 * Leave registry manifest test.
 *
 * Every index must have at least one documented consumer. The build
 * also exercises the FK join against the stub contracts registry so
 * the manifest test doubles as a smoke test for the FK pipeline.
 */

import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildLeaveRegistryFromData } from './registry.js';
import { makeStubContracts } from './test-helpers.js';

describe('leave registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    const reg = buildLeaveRegistryFromData([], { contracts: makeStubContracts() });
    assertManifestConsumers({
      registry: reg,
      consumers: {
        byId: [
          {
            file: 'server/domain/leave/queries.ts',
            functions: ['findLeaveById'],
          },
          {
            file: 'server/domain/leave/registry.gates.test.ts',
            functions: ['indexes.byId'],
          },
        ],
        byContract: [
          {
            file: 'server/domain/leave/queries.ts',
            functions: ['leaveForContract', 'leaveInWindow'],
          },
          {
            file: 'server/domain/leave/registry.gates.test.ts',
            functions: ['indexes.byContract'],
          },
        ],
        byDate: [
          {
            file: 'server/domain/leave/registry.gates.test.ts',
            functions: ['indexes.byDate'],
          },
          {
            file: 'server/domain/leave/registry.invariants.test.ts',
            functions: ['byDate-union-covers-all'],
          },
        ],
        futureByContract: [
          {
            file: 'server/domain/leave/registry.gates.test.ts',
            functions: ['indexes.futureByContract'],
          },
          {
            file: 'server/domain/leave/registry.invariants.test.ts',
            functions: ['futureByContract-subset-byContract'],
          },
        ],
      },
    });
  });
});

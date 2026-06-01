/**
 * Contracts registry manifest test.
 *
 * Every index must have at least one documented consumer. The build
 * also exercises the FK join against stub upstream registries so the
 * manifest test doubles as a smoke test for the full join pipeline.
 */

import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildContractRegistryFromData } from './registry.js';
import { makeStubClients, makeStubCompanies, makeStubMasters } from './test-helpers.js';

describe('contracts registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    const reg = buildContractRegistryFromData([], {
      clients: makeStubClients(),
      companies: makeStubCompanies(),
      masters: makeStubMasters(),
    });
    assertManifestConsumers({
      registry: reg,
      consumers: {
        byId: [
          {
            file: 'server/domain/contracts/queries.ts',
            functions: ['findContractById'],
          },
          {
            file: 'server/domain/contracts/registry.gates.test.ts',
            functions: ['indexes.byId'],
          },
        ],
        byClient: [
          {
            file: 'server/domain/contracts/queries.ts',
            functions: ['listContractsByClient'],
          },
          {
            file: 'server/domain/contracts/registry.gates.test.ts',
            functions: ['indexes.byClient'],
          },
        ],
        byClientAndEntity: [
          {
            file: 'server/domain/contracts/queries.ts',
            functions: ['findContractForTransaction'],
          },
          {
            file: 'server/domain/contracts/registry.gates.test.ts',
            functions: ['indexes.byClientAndEntity'],
          },
        ],
        byMaster: [
          {
            file: 'server/domain/contracts/registry.gates.test.ts',
            functions: ['indexes.byMaster'],
          },
          {
            file: 'server/domain/contracts/registry.invariants.test.ts',
            functions: ['byMaster-only-non-null'],
          },
        ],
      },
    });
  });
});

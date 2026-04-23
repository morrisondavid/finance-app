/**
 * Clients registry manifest test.
 *
 * Asserts every index on the clients registry has at least one
 * documented consumer. Adding an index without wiring a caller fails
 * loudly.
 */

import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildClientRegistry } from './registry.js';

describe('clients registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    const reg = buildClientRegistry();
    assertManifestConsumers({
      registry: reg,
      consumers: {
        byId: [
          {
            file: 'server/domain/clients/queries.ts',
            functions: ['findClientById'],
          },
          {
            file: 'server/domain/contracts/registry.ts',
            functions: ['buildContractRegistryFromData'],
          },
          {
            file: 'server/domain/clients/registry.gates.test.ts',
            functions: ['indexes.byId'],
          },
        ],
        byKind: [
          {
            file: 'server/domain/clients/queries.ts',
            functions: ['listClientsByKind'],
          },
          {
            file: 'server/domain/clients/registry.gates.test.ts',
            functions: ['indexes.byKind'],
          },
        ],
        active: [
          {
            file: 'server/domain/clients/queries.ts',
            functions: ['listActiveClients'],
          },
          {
            file: 'server/domain/clients/registry.gates.test.ts',
            functions: ['indexes.active'],
          },
        ],
      },
    });
  });
});

/**
 * Properties registry manifest test.
 *
 * Asserts that every index has at least one documented consumer somewhere
 * in the repo. Adding a new index without wiring a caller fails this test.
 */

import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildPropertyRegistry } from './registry.js';

describe('properties registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    const reg = buildPropertyRegistry();
    assertManifestConsumers({
      registry: reg,
      consumers: {
        byId: [
          {
            file: 'server/domain/properties/queries.ts',
            functions: ['propertyById', 'isPropertyId'],
          },
          {
            file: 'server/domain/properties/fk-integrity.test.ts',
            functions: ['cross-registry FK integrity'],
          },
        ],
        byAddress: [
          {
            file: 'server/domain/properties/queries.test.ts',
            functions: ['byAddress lookup'],
          },
          {
            file: 'server/domain/properties/registry.invariants.test.ts',
            functions: ['byAddress covers every entry in all'],
          },
        ],
      },
    });
  });
});

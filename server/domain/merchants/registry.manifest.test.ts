/**
 * Merchants registry manifest test.
 *
 * Asserts that every index on the live merchants registry has at
 * least one documented consumer somewhere in the repo. Adding a new
 * index without also wiring a caller fails this test loudly.
 */

import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildMerchantsRegistry } from './registry.js';

describe('merchants registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    const reg = buildMerchantsRegistry();
    assertManifestConsumers({
      registry: reg,
      consumers: {
        patterns: [
          {
            file: 'server/domain/merchants/queries.ts',
            functions: [
              'allMerchantEntries',
              'findFirstCategoryMatch',
              'findFirstNamedMatch',
            ],
          },
          {
            file: 'server/utils/categorizer.ts',
            functions: ['categorizeTransaction'],
          },
          {
            file: 'server/utils/merchant-normalizer.ts',
            functions: ['normalizeMerchant'],
          },
        ],
        byCategory: [
          {
            file: 'server/domain/merchants/queries.ts',
            functions: ['merchantsByCategory'],
          },
          {
            file: 'server/domain/merchants/registry.gates.test.ts',
            functions: ['indexes.byCategory'],
          },
        ],
        byDisplayName: [
          {
            file: 'server/domain/merchants/queries.ts',
            functions: ['merchantByDisplayName'],
          },
          {
            file: 'server/domain/merchants/registry.gates.test.ts',
            functions: ['indexes.byDisplayName'],
          },
        ],
      },
    });
  });
});

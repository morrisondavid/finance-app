/**
 * Transaction-overrides registry manifest test.
 *
 * Asserts every index on the overrides registry has at least one
 * documented consumer. Adding an index without wiring a caller fails
 * loudly.
 */

import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildOverrideRegistry } from './registry.js';

describe('transaction-overrides registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    const reg = buildOverrideRegistry();
    assertManifestConsumers({
      registry: reg,
      consumers: {
        byHash: [
          {
            file: 'server/domain/transaction-overrides/queries.ts',
            functions: ['lookupOverride', 'allOverrides', 'overrideCount'],
          },
          {
            file: 'server/utils/categorizer.ts',
            functions: ['categorizeTransaction'],
          },
          {
            file: 'server/domain/payroll/queries.ts',
            functions: ['transactionCategoryWithPayroll'],
          },
          {
            file: 'server/domain/inter-company/movements-response.ts',
            functions: ['resolvePairClassification'],
          },
          {
            file: 'server/domain/warnings/inter-company-count.ts',
            functions: ['countUnclassifiedInterCompanyPairs'],
          },
        ],
      },
    });
  });
});

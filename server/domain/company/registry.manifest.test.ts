/**
 * Company registry manifest test.
 *
 * Asserts every index on the company registry has at least one
 * documented consumer. Adding an index without wiring a caller fails
 * loudly.
 */

import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildCompanyRegistry } from './registry.js';

describe('company registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    const reg = buildCompanyRegistry();
    assertManifestConsumers({
      registry: reg,
      consumers: {
        byId: [
          {
            file: 'server/domain/company/queries.ts',
            functions: ['companyById'],
          },
          {
            file: 'server/domain/company/registry.gates.test.ts',
            functions: ['indexes.byId'],
          },
        ],
        byJurisdiction: [
          {
            file: 'server/domain/company/queries.ts',
            functions: ['companiesByJurisdiction'],
          },
          {
            file: 'server/domain/company/registry.gates.test.ts',
            functions: ['indexes.byJurisdiction'],
          },
        ],
        active: [
          {
            file: 'server/domain/company/queries.ts',
            functions: ['activeCompanies'],
          },
          {
            file: 'server/domain/company/registry.gates.test.ts',
            functions: ['indexes.active'],
          },
        ],
      },
    });
  });
});

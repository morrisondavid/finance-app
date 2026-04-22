/**
 * People registry manifest test.
 *
 * Asserts that every index on the live people registry has at least
 * one documented consumer somewhere in the repo. Adding a new index
 * without also wiring a caller fails this test loudly.
 *
 * Conventions:
 *   - Production consumers are preferred.
 *   - Test-only consumers are allowed when the index exists purely
 *     as a regression lock, but the entry must name the specific
 *     test file so reviewers know the index is test-only.
 *   - `functions` names the calling function, query, or describe
 *     block.
 */

import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildPeopleRegistry } from './registry.js';

describe('people registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    const reg = buildPeopleRegistry();
    assertManifestConsumers({
      registry: reg,
      consumers: {
        directors: [
          {
            file: 'server/domain/people/queries.ts',
            functions: ['directors', 'directorIds'],
          },
          {
            file: 'server/domain/people/registry.gates.test.ts',
            functions: ['indexes.directors'],
          },
        ],
        saFilers: [
          {
            file: 'server/domain/people/queries.ts',
            functions: ['saFilers', 'saFilerIds'],
          },
          {
            file: 'server/db/repositories/sa-auto-seed.ts',
            functions: ['autoSeedSaObligations'],
          },
        ],
        aliasRegexes: [
          {
            file: 'server/domain/people/queries.ts',
            functions: ['matchPersonInDescription', 'personAliasRegex'],
          },
          {
            file: 'server/domain/payroll/queries.ts',
            functions: ['matchPayrollEntry'],
          },
        ],
      },
    });
  });
});

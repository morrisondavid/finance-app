import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildReserveRegistry } from './registry.js';

describe('reserves registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    const reg = buildReserveRegistry();
    assertManifestConsumers({
      registry: reg,
      consumers: {
        byKey: [
          {
            file: 'server/domain/reserves/queries.ts',
            functions: ['reserveForObligation'],
          },
          {
            file: 'server/domain/warnings/tax-reserve.ts',
            functions: ['deriveTaxReserveWarnings'],
          },
        ],
      },
    });
  });
});

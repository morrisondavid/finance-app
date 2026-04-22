/**
 * Accounts registry manifest test.
 *
 * Asserts that every index on the live accounts registry has ≥1
 * documented consumer. Filled in properly in Phase A5 once the call
 * sites in `recurring-pipeline`, `statements`, `dashboard`, etc. have
 * been rewritten to consume the new indexes directly.
 *
 * For now this test asserts the manifest-test helper works against the
 * real registry shape — it's intentionally permissive (every index
 * mapped to this file) and will be tightened in A5.
 */

import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildAccountsRegistry } from './registry.js';

describe('accounts registry manifest', () => {
  it('placeholder — every index has at least one documented consumer (tightened in A5)', () => {
    const reg = buildAccountsRegistry();
    const self = 'server/domain/accounts/registry.manifest.test.ts';
    assertManifestConsumers({
      registry: reg,
      consumers: {
        business: [{ file: self, functions: ['placeholder'] }],
        personal: [{ file: self, functions: ['placeholder'] }],
        byEntity: [{ file: self, functions: ['placeholder'] }],
        vatApplicable: [{ file: self, functions: ['placeholder'] }],
        vatApplicableByEntity: [{ file: self, functions: ['placeholder'] }],
        corpTaxApplicable: [{ file: self, functions: ['placeholder'] }],
        corpTaxApplicableByEntity: [{ file: self, functions: ['placeholder'] }],
        outgoingPaymentsCapable: [{ file: self, functions: ['placeholder'] }],
        businessOutgoingPayments: [{ file: self, functions: ['placeholder'] }],
        personalOutgoingPayments: [{ file: self, functions: ['placeholder'] }],
        excludeTransfersFromIncome: [{ file: self, functions: ['placeholder'] }],
        showTaxLiabilities: [{ file: self, functions: ['placeholder'] }],
        creditCards: [{ file: self, functions: ['placeholder'] }],
      },
    });
  });
});

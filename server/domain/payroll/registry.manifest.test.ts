/**
 * Payroll registry manifest test.
 *
 * Asserts every index on the derived payroll registry has at least
 * one documented consumer. Adding an index without wiring a caller
 * fails loudly.
 */

import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildPayrollRegistry } from './registry.js';

describe('payroll registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    const reg = buildPayrollRegistry();
    assertManifestConsumers({
      registry: reg,
      consumers: {
        entries: [
          {
            file: 'server/domain/payroll/queries.ts',
            functions: ['allPayrollEntries'],
          },
          {
            file: 'server/domain/payroll/registry.invariants.test.ts',
            functions: ['indexes.entries'],
          },
        ],
        byAccount: [
          {
            file: 'server/domain/payroll/registry.gates.test.ts',
            functions: ['indexes.byAccount'],
          },
          {
            file: 'server/domain/payroll/registry.invariants.test.ts',
            functions: ['indexes.byAccount'],
          },
        ],
        byPersonAccount: [
          {
            file: 'server/domain/payroll/queries.ts',
            functions: ['matchPayrollEntry'],
          },
          {
            file: 'server/domain/payroll/registry.gates.test.ts',
            functions: ['indexes.byPersonAccount'],
          },
        ],
        directorsById: [
          {
            file: 'server/domain/payroll/queries.ts',
            functions: ['getDirectorPayroll'],
          },
          {
            file: 'server/domain/payroll/registry.gates.test.ts',
            functions: ['indexes.directorsById'],
          },
        ],
      },
    });
  });
});

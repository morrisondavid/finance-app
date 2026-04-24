/**
 * Invoices registry manifest test.
 *
 * Asserts every index on the invoices registry has at least one
 * documented consumer. Adding an index without wiring a caller fails
 * loudly. The Phase 2 sequence generator and Phase 4 reconciler
 * append to these consumer lists when they land.
 */

import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildInvoiceRegistry } from './registry.js';

describe('invoices registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    const reg = buildInvoiceRegistry();
    assertManifestConsumers({
      registry: reg,
      consumers: {
        byId: [
          {
            file: 'server/domain/invoices/queries.ts',
            functions: ['findInvoiceById'],
          },
        ],
        byContractId: [
          {
            file: 'server/domain/invoices/queries.ts',
            functions: ['listInvoicesByContractId', 'latestInvoiceForContract'],
          },
          {
            file: 'server/domain/invoices/resolve-next-period.ts',
            functions: ['resolveNextPeriodStart'],
          },
        ],
        byIssuingEntityId: [
          {
            file: 'server/domain/invoices/queries.ts',
            functions: ['listInvoicesByIssuingEntityId'],
          },
        ],
        byStatus: [
          {
            file: 'server/domain/invoices/queries.ts',
            functions: ['listInvoicesByStatus'],
          },
        ],
      },
    });
  });
});

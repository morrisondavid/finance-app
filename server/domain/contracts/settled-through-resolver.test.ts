/**
 * Unit tests for `resolveSettledThroughByContract`.
 *
 * Pure over injected contract + invoice registries (no DB / disk), so we
 * can assert the series-aware "latest invoiced period_end" rule in
 * isolation:
 *   - the anchor spans a `(client, entity)` series via `byClientAndEntity`
 *     (a renewal inherits its predecessor's invoices),
 *   - paid AND issued invoices both count, but drafts never do,
 *   - a series with no non-draft invoices resolves to `null`,
 *   - separate series do not leak into one another.
 */

import { describe, it, expect } from 'vitest';
import { resolveSettledThroughByContract } from './settled-through-resolver.js';
import { buildContractRegistryFromData } from './registry.js';
import { parseContractRow } from './csv-io.js';
import {
  dcSowRow,
  lfContractRow,
  lfExtensionRow,
  lfFzcoContractRow,
  makeStubClients,
  makeStubCompanies,
  makeStubMasters,
} from './test-helpers.js';
import {
  buildInvoiceRegistryFromData,
  type InvoiceRegistry,
} from '../invoices/registry.js';
import { parseInvoiceRow } from '../invoices/csv-io.js';
import { rowFromHeaders as invoiceRowFromHeaders } from '../invoices/test-helpers.js';
import type { InvoiceStatus } from '../invoices/schema.js';

const contractReg = buildContractRegistryFromData(
  [
    parseContractRow(lfContractRow), // lf-2026-mar  (la-fosse | ltd)
    parseContractRow(lfExtensionRow), // lf-extension-1 (same series)
    parseContractRow(lfFzcoContractRow), // lf-2026-apr (la-fosse | fzco)
    parseContractRow(dcSowRow), // dc-sow-2026 (delta-capita | ltd)
  ],
  {
    clients: makeStubClients(),
    companies: makeStubCompanies(),
    masters: makeStubMasters(),
  },
);

interface InvoiceSeed {
  readonly id: string;
  readonly contractId: string;
  readonly entityId: string;
  readonly periodEnd: string;
  readonly status: InvoiceStatus;
}

function mkInvoiceReg(seeds: readonly InvoiceSeed[]): InvoiceRegistry {
  const rows = seeds.map(s =>
    parseInvoiceRow(
      invoiceRowFromHeaders({
        id: s.id,
        contract_id: s.contractId,
        client_id: 'la-fosse',
        issuing_entity_id: s.entityId,
        invoice_number: s.id,
        payment_reference: s.id,
        invoice_date: s.periodEnd,
        period_start: '2026-01-01',
        period_end: s.periodEnd,
        days_billed: '5',
        description: 'test',
        currency: 'GBP',
        subtotal: '2500',
        vat_rate: '0',
        vat_amount: '0',
        total: '2500',
        mechanism: 'self-bill',
        status: s.status,
        due_date: s.periodEnd,
        created_at: s.periodEnd,
      }),
    ),
  );
  return buildInvoiceRegistryFromData(rows);
}

describe('resolveSettledThroughByContract', () => {
  it('takes the max non-draft period_end across the whole series (renewal inherits it)', () => {
    const invoiceReg = mkInvoiceReg([
      { id: 'UK-0001', contractId: 'lf-2026-mar', entityId: 'autonize-it-ltd', periodEnd: '2026-02-28', status: 'paid' },
      { id: 'UK-0002', contractId: 'lf-extension-1', entityId: 'autonize-it-ltd', periodEnd: '2026-04-30', status: 'issued' },
      // Draft with a far-future period must be ignored.
      { id: 'UK-0003', contractId: 'lf-2026-mar', entityId: 'autonize-it-ltd', periodEnd: '2026-12-31', status: 'draft' },
    ]);

    const map = resolveSettledThroughByContract(
      { contracts: contractReg.all },
      contractReg,
      invoiceReg,
    );

    // Both contracts in the la-fosse|ltd series share the same anchor.
    expect(map.get('lf-2026-mar')).toBe('2026-04-30');
    expect(map.get('lf-extension-1')).toBe('2026-04-30');
  });

  it('returns null for a series with no non-draft invoices', () => {
    const invoiceReg = mkInvoiceReg([
      { id: 'DC-901', contractId: 'dc-sow-2026', entityId: 'autonize-it-ltd', periodEnd: '2026-03-31', status: 'draft' },
    ]);

    const map = resolveSettledThroughByContract(
      { contracts: contractReg.all },
      contractReg,
      invoiceReg,
    );

    expect(map.get('dc-sow-2026')).toBeNull();
  });

  it('does not leak invoices across distinct (client, entity) series', () => {
    const invoiceReg = mkInvoiceReg([
      // Only the FZCO series has an invoice.
      { id: 'FZ-0001', contractId: 'lf-2026-apr', entityId: 'autonize-it-fzco', periodEnd: '2026-03-31', status: 'issued' },
    ]);

    const map = resolveSettledThroughByContract(
      { contracts: contractReg.all },
      contractReg,
      invoiceReg,
    );

    expect(map.get('lf-2026-apr')).toBe('2026-03-31');
    // The la-fosse|ltd and delta-capita|ltd series stay null.
    expect(map.get('lf-2026-mar')).toBeNull();
    expect(map.get('dc-sow-2026')).toBeNull();
  });
});

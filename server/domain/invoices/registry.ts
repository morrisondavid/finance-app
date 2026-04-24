/**
 * Invoices registry — single source of truth for every invoice the
 * app has issued, parsed from a self-bill PDF, or imported as a
 * historical seed (§1.3 Phase 1).
 *
 * Load path: `invoices/invoices.csv` is committed with the 10 Delta
 * Capita historical rows. The registry is lazily built at first
 * access via {@link createRegistry} and cached for the lifetime of
 * the process.
 *
 * Every question the registry answers is a precomputed index. Callers
 * read `registry.indexes.<name>` — no consumer re-filters `all`.
 *
 * Adding a new named question:
 *   1. Add the field to `InvoiceRegistry.indexes` below.
 *   2. Populate it in `buildInvoiceRegistryFromData` using the
 *      `_shared` index builders.
 *   3. Expose a named query in `queries.ts`.
 *   4. Document the consumer(s) in `registry.manifest.test.ts`.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type {
  ContractId,
  EntityId,
} from '../../../shared/api-contracts.js';
import type {
  Invoice,
  InvoiceId,
  InvoiceStatus,
} from './schema.js';
import { createRegistry } from '../_shared/create-registry.js';
import { groupBy, indexBy } from '../_shared/index-builders.js';
import { getInvoicesCsvPath, readInvoicesCsvFile } from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_INVOICES_DIR = path.join(__dirname, '../../../invoices');

export interface InvoiceRegistry {
  /** Every invoice in CSV order. */
  readonly all: readonly Invoice[];
  readonly indexes: {
    /** Primary-key lookup. Duplicate ids fail at build time. */
    readonly byId: ReadonlyMap<InvoiceId, Invoice>;
    /**
     * Every invoice for a given contract, sorted by `invoice_date`
     * ascending. `resolveNextPeriodStart` reads the tail of this list
     * to find the most recent non-draft invoice in O(n) once.
     */
    readonly byContractId: ReadonlyMap<ContractId, readonly Invoice[]>;
    /**
     * Every invoice issued by a given entity, in CSV order. The
     * per-entity sequence generator reads this to find the next id
     * (`DC-###` for Delta Capita, else `UK-####` / `FZ-####`).
     */
    readonly byIssuingEntityId: ReadonlyMap<EntityId, readonly Invoice[]>;
    /** Every invoice grouped by lifecycle status. */
    readonly byStatus: ReadonlyMap<InvoiceStatus, readonly Invoice[]>;
  };
}

/**
 * Sort invoices by `invoice_date` ascending. Ties broken by `id` so
 * the order is fully deterministic even when two invoices share a
 * date.
 */
function sortByInvoiceDate(invoices: readonly Invoice[]): readonly Invoice[] {
  return [...invoices].sort((a, b) => {
    if (a.invoice_date !== b.invoice_date) return a.invoice_date < b.invoice_date ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function buildInvoiceRegistryFromData(
  all: readonly Invoice[],
): InvoiceRegistry {
  const byId = indexBy(all, i => i.id, { indexName: 'invoices.byId' });

  // groupBy preserves insertion order; wrap each list with a stable
  // invoice_date sort so the "latest invoice" lookup is an O(1)
  // last-element read.
  const grouped = groupBy(all, i => i.contract_id);
  const byContractId = new Map<ContractId, readonly Invoice[]>();
  for (const [key, rows] of grouped) {
    byContractId.set(key, sortByInvoiceDate(rows));
  }

  const byIssuingEntityId = groupBy(all, i => i.issuing_entity_id);
  const byStatus = groupBy(all, i => i.status);

  return {
    all,
    indexes: {
      byId,
      byContractId,
      byIssuingEntityId,
      byStatus,
    },
  };
}

export function buildInvoiceRegistry(
  invoicesDir: string = DEFAULT_INVOICES_DIR,
): InvoiceRegistry {
  return buildInvoiceRegistryFromData(
    readInvoicesCsvFile(getInvoicesCsvPath(invoicesDir)),
  );
}

const handle = createRegistry<InvoiceRegistry>({
  name: 'invoices',
  build: () => buildInvoiceRegistry(),
});

export const getInvoiceRegistry = handle.get;
export const invalidateInvoiceRegistry = handle.invalidate;
export const __resetInvoiceRegistryForTests = handle.__resetForTests;

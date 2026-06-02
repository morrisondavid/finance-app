/**
 * "Settled-through" resolver — the single anchor that decides where
 * contract accrual begins.
 *
 * For a contract, `settledThrough` is the latest invoiced work period:
 * the maximum `period_end` across every non-draft invoice (paid OR
 * issued) for the contract's *series*. "Series" means every contract
 * sharing the same `(client_id, issuing_entity_id)` pair — looked up via
 * the registry `byClientAndEntity` index — so the anchor flows across
 * renewals. A follow-on contract therefore starts accruing the day after
 * the prior contract's last invoiced period, not from its own start.
 *
 * Why period_end and not the payment date: the payment *landing* date
 * lags the worked period by ~the payment terms (often ~30 days), so
 * anchoring on it would silently drop a whole worked-but-unpaid month.
 * Anchoring on the latest invoiced `period_end` means "everything worked
 * since the last invoiced period is owed" — exactly the rule the owed
 * window needs. Issued-but-unpaid invoices are included so the
 * invoice-receipt path (which projects those invoices) and the accrual
 * path (which projects the worked tail after them) never overlap.
 *
 * Draft invoices are excluded: a draft is not a committed receivable and
 * is not emitted by any forecast path, so its period must still accrue.
 *
 * Returns `Map<ContractId, string | null>` — `null` for a series with no
 * non-draft invoices yet (brand-new engagement), which callers treat as
 * "no settled anchor, fall back to last payment / contract start".
 */

import type {
  Contract,
  ContractId,
} from '../../../shared/api-contracts.js';
import {
  listInvoicesByContractId,
} from '../invoices/queries.js';
import type { InvoiceRegistry } from '../invoices/registry.js';
import {
  clientEntityKey,
  getContractRegistry,
  type ContractRegistry,
} from './registry.js';

export interface ResolveSettledThroughInput {
  readonly contracts: readonly Contract[];
}

/** Latest non-draft invoiced `period_end` across a `(client, entity)` series. */
function seriesSettledThrough(
  seriesKey: string,
  contractReg: ContractRegistry,
  invoiceReg: InvoiceRegistry | undefined,
): string | null {
  const series = contractReg.indexes.byClientAndEntity.get(seriesKey) ?? [];
  let latest: string | null = null;
  for (const contract of series) {
    for (const invoice of listInvoicesByContractId(contract.id, invoiceReg)) {
      if (invoice.status === 'draft') continue;
      if (latest === null || invoice.period_end > latest) latest = invoice.period_end;
    }
  }
  return latest;
}

/**
 * Resolve the series-aware settled-through anchor for each contract.
 *
 * Computed once per series and shared across that series' contracts so a
 * client with several renewals scans its invoices a single time.
 */
export function resolveSettledThroughByContract(
  input: ResolveSettledThroughInput,
  contractReg: ContractRegistry = getContractRegistry(),
  invoiceReg?: InvoiceRegistry,
): Map<ContractId, string | null> {
  const out = new Map<ContractId, string | null>();
  const seriesCache = new Map<string, string | null>();
  for (const contract of input.contracts) {
    const key = clientEntityKey(contract.client_id, contract.issuing_entity_id);
    if (!seriesCache.has(key)) {
      seriesCache.set(key, seriesSettledThrough(key, contractReg, invoiceReg));
    }
    out.set(contract.id, seriesCache.get(key) ?? null);
  }
  return out;
}

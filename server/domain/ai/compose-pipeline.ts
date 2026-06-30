/**
 * §2.0.E AI pipeline slice — merges obligation outflows with expected
 * contract receipts using the same collectors as the forecast engine.
 */

import type { AiPipelineResponse } from '../../../shared/api-contracts.js';
import { AiPipelineResponseSchema } from '../../../shared/api-contracts.js';
import { composeExpectedReceiptsFromLoaded } from '../contracts/expected-receipts.js';
import { collectObligationEvents } from '../forecast/collect-events.js';
import type {
  LoadedForecastInputs,
  LoadForecastInputsOpts,
} from '../forecast/load-inputs.js';
import { loadForecastInputs } from '../forecast/load-inputs.js';

/**
 * Build the pipeline slice from an already-loaded forecast bundle (e.g. AI
 * snapshot shares one `loadForecastInputs` call with runway).
 */
export function buildAiPipelineFromLoaded(loaded: LoadedForecastInputs): AiPipelineResponse {
  const obById = new Map(loaded.obligations.map(o => [o.id, o]));

  const obligationEvents = collectObligationEvents({
    obligations: loaded.obligations,
    defaultAccountByType: loaded.defaultAccountByType,
    currencyByAccount: loaded.currencyByAccount,
    horizon: loaded.horizon,
  });

  const receipts = composeExpectedReceiptsFromLoaded(loaded);

  const rows: AiPipelineResponse['rows'] = [];

  for (const e of obligationEvents) {
    if (!loaded.allowedAccountSet.has(e.account)) continue;
    const ob = e.obligationId !== undefined ? obById.get(e.obligationId) : undefined;
    rows.push({
      date: e.date,
      amount: e.amount,
      currency: e.currency,
      account: e.account,
      kind: 'obligation',
      label: e.label,
      obligationId: e.obligationId ?? null,
      receiptSource: null,
      obligationType: ob?.type ?? null,
      contractId: null,
      invoiceId: null,
    });
  }

  for (const r of receipts.receipts) {
    const label = r.source === 'accrual'
      ? `Accrual ${r.contractId ?? ''}`
      : r.source === 'rental-income'
        ? `Rental ${r.obligationId ?? ''}`
        : `Invoice ${r.invoiceId ?? ''}`;
    rows.push({
      date: r.expectedDate,
      amount: r.amount,
      currency: r.currency,
      account: r.account,
      kind: 'expected-receipt',
      label,
      obligationId: r.obligationId,
      receiptSource: r.source,
      obligationType: null,
      contractId: r.contractId,
      invoiceId: r.invoiceId,
    });
  }

  rows.sort((a, b) => {
    const cmpDate = a.date.localeCompare(b.date);
    if (cmpDate !== 0) return cmpDate;
    return `${a.kind}|${a.label}`.localeCompare(`${b.kind}|${b.label}`);
  });

  return AiPipelineResponseSchema.parse({
    asOf: loaded.today,
    horizon: loaded.horizon,
    rows,
  });
}

export function composeAiPipeline(opts: LoadForecastInputsOpts = {}): AiPipelineResponse {
  return buildAiPipelineFromLoaded(loadForecastInputs(opts));
}

/**
 * GET /api/ai/upcoming — reuses `buildAiPipelineFromLoaded` rows bucketed by month.
 */

import type { AiUpcomingResponse, EntityId } from '../../../shared/api-contracts.js';
import { AiUpcomingResponseSchema } from '../../../shared/api-contracts.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import { loadForecastInputs } from '../forecast/load-inputs.js';
import { round2 } from '../../utils/math.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';
import { buildAiPipelineFromLoaded } from './compose-pipeline.js';

export interface ComposeAiUpcomingOpts {
  readonly months?: number;
  readonly kind?: 'expenses' | 'income' | 'both';
  readonly filterEntityId?: EntityId;
}

const AVG_DAYS_PER_MONTH = 30.4375;

export function composeAiUpcoming(opts: ComposeAiUpcomingOpts = {}): AiUpcomingResponse {
  const months = opts.months ?? 3;
  const kind = opts.kind ?? 'both';
  const horizonDays = Math.ceil(months * AVG_DAYS_PER_MONTH);
  const loaded = loadForecastInputs({
    horizonDays,
    filterEntityId: opts.filterEntityId,
  });
  const pipeline = buildAiPipelineFromLoaded(loaded);

  const bucketMap = new Map<string, { expensesGbp: number; incomeGbp: number }>();

  for (const row of pipeline.rows) {
    if (row.date < loaded.today) continue;
    const month = row.date.slice(0, 7);
    const entry = bucketMap.get(month) ?? { expensesGbp: 0, incomeGbp: 0 };
    const gbp = convertAmountSync(Math.abs(row.amount), row.currency, 'GBP');
    if (row.kind === 'obligation' || row.amount < 0) {
      entry.expensesGbp = round2(entry.expensesGbp + gbp);
    } else {
      entry.incomeGbp = round2(entry.incomeGbp + gbp);
    }
    bucketMap.set(month, entry);
  }

  const buckets = [...bucketMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, months)
    .map(([month, v]) => ({
      month,
      expensesGbp: kind === 'income' ? 0 : v.expensesGbp,
      incomeGbp: kind === 'expenses' ? 0 : v.incomeGbp,
      net: round2((kind === 'expenses' ? 0 : v.incomeGbp) - (kind === 'income' ? 0 : v.expensesGbp)),
    }));

  const totals = buckets.reduce(
    (acc, b) => ({
      expensesGbp: round2(acc.expensesGbp + b.expensesGbp),
      incomeGbp: round2(acc.incomeGbp + b.incomeGbp),
      net: round2(acc.net + b.net),
    }),
    { expensesGbp: 0, incomeGbp: 0, net: 0 },
  );

  return AiUpcomingResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
    asOf: loaded.today,
    months,
    buckets,
    totals,
  });
}

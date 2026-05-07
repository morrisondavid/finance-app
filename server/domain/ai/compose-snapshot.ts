import type { AiSnapshotResponse, EntityId } from '../../../shared/api-contracts.js';
import { AiSnapshotResponseSchema } from '../../../shared/api-contracts.js';
import { assembleRunway, runwayResponseFromAssembled } from '../forecast/index.js';
import { loadForecastInputs } from '../forecast/load-inputs.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';
import { composeAiLiquidity } from './compose-liquidity.js';
import { buildAiPipelineFromLoaded } from './compose-pipeline.js';

export interface ComposeAiSnapshotOpts {
  readonly horizonDays?: number;
  readonly filterEntityId?: EntityId;
  readonly runwayDetail?: 'accounts' | 'summary';
  readonly account?: string;
  readonly financialYear?: string;
  readonly groupByEntity?: boolean;
}

export function composeAiSnapshot(opts: ComposeAiSnapshotOpts = {}): AiSnapshotResponse {
  const horizonDays = opts.horizonDays ?? 720;
  const filterEntityId = opts.filterEntityId;
  const loaded = loadForecastInputs({ horizonDays, filterEntityId });

  const liquidity = composeAiLiquidity({
    account: opts.account,
    financialYear: opts.financialYear,
    groupByEntity: opts.groupByEntity,
  });
  const pipeline = buildAiPipelineFromLoaded(loaded);
  const assembled = assembleRunway({ forecastInputs: loaded });
  const runway = runwayResponseFromAssembled(assembled, opts.filterEntityId, {
    detail: opts.runwayDetail ?? 'summary',
  });

  return AiSnapshotResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
    liquidity,
    pipeline,
    runway,
  });
}

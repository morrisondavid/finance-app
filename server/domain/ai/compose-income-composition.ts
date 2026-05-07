import { IncomeCompositionResponseSchema } from '../../../shared/api-contracts.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { assembleIncomeComposition } from '../income-composition/index.js';

export function composeAiIncomeComposition() {
  const today = todayIsoLocal();
  const { sources, composition, riskSignals } = assembleIncomeComposition();

  return IncomeCompositionResponseSchema.parse({
    today,
    household: composition.household,
    byEntity: composition.byEntity,
    sources,
    riskSignals,
  });
}

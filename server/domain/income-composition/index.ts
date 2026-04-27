/**
 * Income composition — public barrel.
 *
 * Service module (NOT a registry). Same shape as `server/domain/forecast/`.
 */

export {
  INCOME_ACTIVITY_CLASS,
  type ActivityClass,
  type IncomeKind,
} from './activity-class.js';

export {
  listAllIncomeSources,
  type IncomeSource,
  type ListAllIncomeSourcesInput,
} from './aggregator.js';

export {
  computeIncomeComposition,
  type IncomeCompositionMetrics,
  type IncomeCompositionResult,
  type IncomeCompositionScope,
  type ClientConcentration,
  type ActivePassiveRatio,
  type TimeIndependence,
  type ComputeIncomeCompositionInput,
} from './metrics.js';

export {
  computeRiskSignals,
  type RiskSignal,
  type RiskSeverity,
  type ComputeRiskSignalsInput,
  type PropertyLeverageInput,
  CLIENT_CONCENTRATION_EXTREME,
  CLIENT_CONCENTRATION_ELEVATED,
  TIME_INDEPENDENCE_LOW,
  TIME_INDEPENDENCE_ELEVATED,
  TIME_INDEPENDENCE_TARGET,
  MODE_CONCENTRATION_EXTREME,
  LEVERAGED_PASSIVE_HIGH,
  LEVERAGED_PASSIVE_MEDIUM,
} from './risk-signals.js';

export {
  assembleIncomeComposition,
  type AssembledIncomeComposition,
} from './assemble.js';

// Schema
export {
  PlanSchema,
  PlansDataSchema,
  PlanGoalTypeSchema,
  PlanIntensitySchema,
  PlanScopeSchema,
  PlanPersistedStatusSchema,
  PlanStatusSchema,
  SuggestedPlanSchema,
  PLAN_TARGET_DATE_ASAP,
  type Plan,
  type PlansData,
  type PlanGoalType,
  type PlanIntensity,
  type PlanScope,
  type PlanStatus,
  type PlanPersistedStatus,
  type SuggestedPlan,
  type PlanTargetDate,
} from './schema.js';

// Registry
export {
  buildPlanRegistry,
  buildPlanRegistryFromData,
  getPlanRegistry,
  invalidatePlanRegistry,
  __resetPlanRegistryForTests,
  type PlanRegistry,
} from './registry.js';

// CSV I/O
export {
  PLANS_CSV_FILENAME,
  PLAN_CSV_HEADERS,
  parsePlanRow,
  readPlansCsvFile,
  writePlansCsvFile,
  getPlansCsvPath,
} from './csv-io.js';

// Data
export { DEFAULT_DEBT_STRATEGY_DIR, loadPlansData } from './data.js';

// Queries
export {
  allPlans,
  planById,
  plansByStatus,
  plansByGoalType,
  plansByTargetId,
  livePlans,
  activePlans,
  completedPlans,
  pausedPlans,
} from './queries.js';

// Fixtures
export { makeTestPlanRegistry } from './fixtures.js';

// Pure planner modules
export { computeHeadroom, type ComputeHeadroomInput, type CategoryBudgetInput } from './compute-headroom.js';
export { availableHeadroom, type AvailableHeadroomInput } from './available-headroom.js';
export {
  presentIntensityOptions,
  type PresentIntensityOptionsInput,
  type IntensityOptionsResult,
  type IntensityOption,
  type IntensityGoalInput,
} from './present-intensity-options.js';
export {
  generatePlan,
  type GeneratePlanInput,
  type GeneratePlanResult,
  type GeneratePlanSuccess,
  type GeneratePlanBlocked,
  type GeneratePlanGoal,
} from './generate-plan.js';
export {
  checkPlanFeasibility,
  type CheckPlanFeasibilityInput,
  type FeasibilityReport,
  type FeasibilityStatus,
  type SuggestedRemedy,
} from './check-plan-feasibility.js';
export {
  evaluateRefinanceTradeoff,
  evaluateRefinanceTradeoffWithToday,
  type EvaluateRefinanceTradeoffInput,
  type EvaluateRefinanceTradeoffResult,
  type RefinanceSourceDebt,
  type RefinancePlanProjection,
} from './evaluate-refinance-tradeoff.js';
export {
  detectTargetReached,
  type DetectTargetReachedInput,
  type DetectPayOffDebtInput,
  type DetectSaveForTargetInput,
  type DetectTargetReachedResult,
} from './detect-target-reached.js';
export {
  autoSuggestPlans,
  bucketKey,
  type AutoSuggestPlansInput,
  type AutoSuggestDebt,
} from './auto-suggest-plans.js';

// Orchestrator
export {
  assembleDebtStrategy,
  type AssembleDebtStrategyInput,
  type AssembledDebtStrategy,
  type BucketHeadroom,
} from './assemble.js';

export {
  type StrategyBucketKey,
  parseStrategyBucketKey,
} from './strategy-bucket-key.js';

export {
  DEFAULT_STRATEGY_MAX_PLANNING_DAYS,
  resolveStrategyPlanningEndDate,
  buildDeployableLiquidityByBucket,
  buildTypicalMonthlyBillsByBucket,
  buildCreditCardPaydownHints,
  assembleStrategyCapitalSnapshot,
  approxStrategyPeriodMonths,
  sumMoneyForDebtStrategyHolisticInCurrency,
  buildHolisticStrategyRollup,
  buildRecommendedLumpSumAllocations,
  type HolisticStrategyCapitalRollup,
  type RecommendedLumpSumAllocation,
  type CreditCardPaydownHint,
  type StrategyCapitalBucketSnapshot,
  type AssembledStrategyCapitalSnapshot,
} from './strategy-capital.js';

export { effectiveHeadroomForStrategyPlanning } from './effective-headroom-for-strategy.js';

export {
  computeMonthsOfBillCoverAfterPlan,
  isPlanViableAgainstBillCoverFloor,
  meetsBillCoverComfortTarget,
} from './bill-cover.js';

export {
  recommendRefinanceFromTradeoff,
  type RefinanceRecommendation,
  type RefinanceRecommendationKind,
} from './recommend-refinance.js';

export {
  evaluateCrossScopeTransferPlaceholder,
  type CrossScopeTransferEvaluation,
  type CrossScopeTransferReasonCode,
} from './evaluate-cross-scope-transfer.js';

// Movements (sibling registry)
export {
  MovementSchema,
  MovementsDataSchema,
  type Movement,
  type MovementsData,
} from './movements-schema.js';

export {
  buildMovementRegistry,
  buildMovementRegistryFromData,
  getMovementRegistry,
  invalidateMovementRegistry,
  __resetMovementRegistryForTests,
  type MovementRegistry,
} from './movements-registry.js';

export {
  MOVEMENTS_CSV_FILENAME,
  MOVEMENT_CSV_HEADERS,
  parseMovementRow,
  readMovementsCsvFile,
  writeMovementsCsvFile,
  getMovementsCsvPath,
} from './movements-csv-io.js';

export { loadMovementsData } from './movements-data.js';

export {
  allMovements,
  movementById,
  listMovementsByPlan,
} from './movements-queries.js';

export { makeTestMovementRegistry } from './movements-fixtures.js';

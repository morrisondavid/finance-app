/**
 * Forecast domain — pure cash-flow projection engine (§1.5).
 *
 * The engine is split into three layers:
 *   1. Event types ({@link ForecastEvent}) — the uniform cash-movement shape.
 *   2. Collectors — convert obligations, recurring, invoices, accrual into events.
 *   3. Timeline walker ({@link buildForecast}) — walks day-by-day, produces series.
 *
 * The route layer loads data from DB/registries and feeds it through
 * the collectors, then into the walker. Everything below is pure.
 */

export { type ForecastEvent, type ForecastEventSource } from './events.js';

export {
  collectObligationEvents,
  collectRecurringEvents,
  collectInvoiceReceiptEvents,
  collectAccrualEvents,
  primaryAccountForEntity,
  type CollectObligationEventsInput,
  type CollectRecurringEventsInput,
  type CollectInvoiceReceiptEventsInput,
  type CollectAccrualEventsInput,
} from './collect-events.js';

export {
  buildForecast,
  type BuildForecastInput,
  type ForecastResult,
  type ForecastAccountSeries,
  type ForecastEntitySummary,
  type ForecastDailyPoint,
  type AccountStartingBalance,
} from './build-forecast.js';

export {
  assembleForecastEvents,
  pickMonthlyRecurringForForecast,
  type AssembleForecastEventsParams,
} from './assemble-forecast-events.js';

export {
  mergeAccountSeriesByCurrency,
  firstNegativeBalanceDate,
  runwayMonthsToDate,
  daysBetweenIsoUtc,
} from './runway-metrics.js';

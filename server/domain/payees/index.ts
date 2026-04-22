/**
 * Payees domain — public barrel.
 *
 * Not a registry — the HMRC narrative patterns are flat pattern
 * lists, not set-wise queryable records, so the payees module is a
 * plain collection of typed constants and helpers rather than a
 * `createRegistry` shape. Hydrated director records have moved to
 * the payroll module (see `server/domain/payroll/queries.ts::
 * getDirectorPayroll`) because they're the product of joining the
 * people registry with the obligations registry — director
 * identity lives in people, salary figures live in payroll.
 */

export {
  HMRC_NARRATIVE_PATTERNS,
  HMRC_PATTERNS,
  buildHmrcNarrativeCaseSql,
  type HmrcNarrativeKey,
} from './hmrc-patterns.js';

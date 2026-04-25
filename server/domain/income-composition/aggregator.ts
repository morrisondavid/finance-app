/**
 * Income aggregator — joins every existing income surface into a single
 * uniform `IncomeSource` list (§1.7).
 *
 * Three upstream sources:
 *   1. Active contracts → `kind: 'contract'`, `active`.
 *   2. Rental-income obligations → `kind: 'rental-income'`, `passive`.
 *   3. Recurring-pipeline detected income that isn't already represented
 *      by 1 or 2 → `kind: 'recurring-detected'`, `passive`.
 *
 * Dedupe is the only transform applied to source figures — there is NO
 * netting on the income side. Rental income is the obligation's gross
 * `amount`; contract income is `day_rate × workingDaysPerMonth(weekday
 * mask)`; recurring-detected is the detector's `amount`.
 */

import type {
  Contract,
  CurrencyCode,
  EntityId,
  Obligation,
  RecurringExpense,
} from '../../../shared/api-contracts.js';
import { SPECIAL_CATEGORY } from '../../../shared/special-category.js';
import { contractWeekdayMask } from '../working-days/weekday-mask.js';
import { INCOME_ACTIVITY_CLASS, type ActivityClass, type IncomeKind } from './activity-class.js';

export interface IncomeSource {
  readonly kind: IncomeKind;
  /**
   * Stable id for this source. For `kind: 'contract'` it's the contract id;
   * for `rental-income` it's the obligation id; for `recurring-detected`
   * it's a synthesised id from the detector's merchant + sourceAccount.
   */
  readonly id: string;
  /** Human-friendly label (client trading name, property address, merchant). */
  readonly label: string;
  /** Monthly amount in `currency`. Gross — no netting applied here. */
  readonly monthlyAmount: number;
  readonly currency: CurrencyCode;
  /** Issuing entity (UK Ltd / FZCO) for company-level income; null for household-personal income. */
  readonly entityId: EntityId | null;
  readonly activityClass: ActivityClass;
  /** Set when this source is associated with a property (rental income). */
  readonly propertyId: string | null;
  /**
   * For `kind: 'contract'`: the client id (used for client concentration).
   * For other kinds: null.
   */
  readonly clientId: string | null;
}

/**
 * Average working days per month from a contract's `works_*` weekday mask.
 * Uses the canonical UK average (≈ 52.143 weeks ÷ 12 ≈ 4.345 weeks per
 * month) times the count of true entries in the mask. For the standard
 * Mon-Fri (5 active weekdays) this yields ≈ 21.7 days/month.
 */
const WEEKS_PER_MONTH = 52.143 / 12;

function avgWorkingDaysPerMonth(contract: Contract): number {
  const mask = contractWeekdayMask(contract);
  const activeWeekdays = mask.filter(Boolean).length;
  return activeWeekdays * WEEKS_PER_MONTH;
}

function contractMonthlyEquivalent(contract: Contract): number {
  const days = avgWorkingDaysPerMonth(contract);
  if (contract.invoice_cadence === 'weekly') {
    // Same daily rate, just billed weekly — monthly equivalent unchanged.
    return contract.day_rate * days;
  }
  return contract.day_rate * days;
}

/**
 * Recurring-pipeline categories whose income lines we deliberately
 * **skip** to avoid double-counting:
 *
 * - `Property` — already covered by rental-income obligations.
 * - `Payroll` — director salary from UK Ltd / FZCO is an internal
 *   transfer of contract revenue we already count at the company level.
 * - `Dividends` — same reason as payroll.
 * - `Transfers` — not real income.
 * - `Income` — generic catch-all the detector uses when it can't
 *   classify; dropping it here avoids low-signal noise in the source
 *   list. Anything genuinely new (savings interest, royalties, refunds)
 *   classifies into a more specific category.
 */
const DEDUPLICATED_INCOME_CATEGORIES: ReadonlySet<string> = new Set([
  SPECIAL_CATEGORY.property,
  SPECIAL_CATEGORY.payroll,
  SPECIAL_CATEGORY.transfers,
  SPECIAL_CATEGORY.income,
  'Dividends',
]);

export interface ListAllIncomeSourcesInput {
  readonly contracts: readonly Contract[];
  readonly obligations: readonly Obligation[];
  readonly monthlyIncomeRecurring: readonly RecurringExpense[];
  /** Map from contract.client_id → trading_name, used for the source label. */
  readonly clientLabelById: ReadonlyMap<string, string>;
}

export function listAllIncomeSources(input: ListAllIncomeSourcesInput): IncomeSource[] {
  const out: IncomeSource[] = [];

  // 1. Contracts (active only).
  for (const c of input.contracts) {
    if (!c.active) continue;
    const monthly = contractMonthlyEquivalent(c);
    const label = input.clientLabelById.get(c.client_id) ?? c.client_id;
    out.push({
      kind: 'contract',
      id: c.id,
      label,
      monthlyAmount: monthly,
      currency: c.invoice_currency,
      entityId: c.issuing_entity_id,
      activityClass: INCOME_ACTIVITY_CLASS.contract,
      propertyId: null,
      clientId: c.client_id,
    });
  }

  // 2. Rental-income obligations.
  for (const o of input.obligations) {
    if (o.category !== 'rental-income') continue;
    out.push({
      kind: 'rental-income',
      id: o.id,
      label: o.displayName ?? o.merchant,
      monthlyAmount: o.amount,
      currency: o.currency,
      entityId: null,
      activityClass: INCOME_ACTIVITY_CLASS['rental-income'],
      propertyId: o.propertyId ?? null,
      clientId: null,
    });
  }

  // 3. Recurring-detected income, deduped against the categories that are
  //    already represented above (rental, payroll, dividends, transfers, generic).
  for (const r of input.monthlyIncomeRecurring) {
    if (DEDUPLICATED_INCOME_CATEGORIES.has(r.category)) continue;
    out.push({
      kind: 'recurring-detected',
      id: `recurring:${r.sourceAccount}:${r.merchant}`,
      label: r.merchant,
      monthlyAmount: r.amount,
      currency: (r.nativeCurrency as CurrencyCode | undefined) ?? 'GBP',
      entityId: null,
      activityClass: INCOME_ACTIVITY_CLASS['recurring-detected'],
      propertyId: null,
      clientId: null,
    });
  }

  return out;
}

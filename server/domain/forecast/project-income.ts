/**
 * Canonical "how much income across these dates?" primitive.
 *
 * Anywhere the codebase needs to project future income for a window
 * — § 1.9 headroom math, future Tier-2 agents asking the WhatsApp
 * bot "what's my expected income for May?", a § 2.0 endpoint that
 * surfaces month-ahead receipts — calls this single named function.
 *
 * Composition:
 *   1. Load the canonical forecast inputs (`loadForecastInputs`).
 *   2. Build the live forecast event stream (`assembleForecastEvents`
 *      with `includeAccrual: true, includeInvoiceReceipts: true`,
 *      `recurringPredicate: undefined`). This is the same "live"
 *      projection `/api/forecast` already exposes — accrual events
 *      come from § 1.4's working-days × day-rate computation per
 *      active contract.
 *   3. Filter to events whose `amount > 0` and `date` falls within
 *      `[from, to)`.
 *   4. Apply optional `bucketFilter`.
 *   5. Aggregate into a `Map<bucketKey(currency, scope), sum>`.
 *
 * Pure: callers can pass `preLoaded` to skip the loader.
 */

import {
  type AccountName,
  type CurrencyCode,
} from '../../../shared/api-contracts.js';
import { ACCOUNT_CONFIG_DATA } from '../accounts/data.js';
import {
  loadForecastInputs,
  type LoadedForecastInputs,
} from './load-inputs.js';
import { assembleForecastEvents } from './assemble-forecast-events.js';
import type { ForecastEvent } from './events.js';
import type { PlanScope } from '../debt-strategy/schema.js';

/**
 * Bucket key shared with § 1.9. Defined here (the canonical home for
 * forecast-level abstractions) and re-exported by § 1.9's
 * `auto-suggest-plans.ts` so existing call sites keep their import.
 */
export function bucketKey(currency: CurrencyCode, scope: PlanScope): string {
  return `${currency}::${scope}`;
}

/**
 * Routing rule: business accounts bucket under their `entityId`,
 * personal accounts under `'household'`.
 */
export function scopeForAccount(account: AccountName): PlanScope {
  const cfg = ACCOUNT_CONFIG_DATA[account];
  if (cfg.category === 'business') return cfg.entityId;
  return 'household';
}

export interface ProjectIncomeForWindowInput {
  /** ISO date `YYYY-MM-DD`, inclusive. */
  readonly from: string;
  /** ISO date `YYYY-MM-DD`, exclusive. */
  readonly to: string;
  /**
   * Pre-loaded forecast inputs. When omitted, this function calls
   * `loadForecastInputs({ today: from })` itself.
   */
  readonly preLoaded?: LoadedForecastInputs;
  /** Optional bucket narrowing; `undefined` means "all buckets". */
  readonly bucketFilter?: {
    readonly currency?: CurrencyCode;
    readonly scope?: PlanScope;
  };
}

export interface ProjectedIncome {
  readonly windowFrom: string;
  readonly windowTo: string;
  /** Sum of positive forecast amounts per `bucketKey(currency, scope)`. */
  readonly byBucket: ReadonlyMap<string, number>;
  /** The events that contributed (handy for downstream UI / debugging). */
  readonly contributingEvents: readonly ForecastEvent[];
}

export function projectIncomeForWindow(
  input: ProjectIncomeForWindowInput,
): ProjectedIncome {
  const inputs = input.preLoaded ?? loadForecastInputs({ today: input.from });

  const allEvents = assembleForecastEvents({
    today: inputs.today,
    horizon: inputs.horizon,
    defaultAccountByType: inputs.defaultAccountByType,
    currencyByAccount: inputs.currencyByAccount,
    accountsByEntity: inputs.accountsByEntity,
    obligations: inputs.obligations,
    pipeline: inputs.pipeline,
    upcomingBuckets: inputs.upcomingBuckets,
    unpaidInvoices: inputs.unpaidInvoices,
    contracts: inputs.contracts,
    accrualWindowStartByContractId: inputs.accrualWindowStartByContractId,
    leaveRows: inputs.leaveRows,
    publicHolidayDatesByEntity: inputs.publicHolidayDatesByEntity,
    includeInvoiceReceipts: true,
    includeAccrual: true,
    recurringPredicate: undefined,
  });

  const contributing: ForecastEvent[] = [];
  const byBucket = new Map<string, number>();
  for (const e of allEvents) {
    if (e.amount <= 0) continue;
    if (e.date < input.from || e.date >= input.to) continue;

    const scope = scopeForAccount(e.account);
    if (input.bucketFilter?.currency !== undefined && input.bucketFilter.currency !== e.currency) {
      continue;
    }
    if (input.bucketFilter?.scope !== undefined && input.bucketFilter.scope !== scope) {
      continue;
    }

    const key = bucketKey(e.currency, scope);
    byBucket.set(key, (byBucket.get(key) ?? 0) + e.amount);
    contributing.push(e);
  }

  return {
    windowFrom: input.from,
    windowTo: input.to,
    byBucket,
    contributingEvents: contributing,
  };
}

export interface StrategyWindowCashflows {
  readonly windowFrom: string;
  readonly windowTo: string;
  /** Positive forecast amounts per bucket (income). */
  readonly incomeByBucket: ReadonlyMap<string, number>;
  /** Absolute value of negative forecast amounts per bucket (outgoings). */
  readonly outflowTotalByBucket: ReadonlyMap<string, number>;
}

/**
 * Single pass over the live forecast event stream: dated inflows and
 * outflows between `[from, to)` for capital-aware debt strategy.
 */
export function projectStrategyWindowCashflows(
  input: ProjectIncomeForWindowInput,
): StrategyWindowCashflows {
  const inputs = input.preLoaded ?? loadForecastInputs({ today: input.from });

  const allEvents = assembleForecastEvents({
    today: inputs.today,
    horizon: inputs.horizon,
    defaultAccountByType: inputs.defaultAccountByType,
    currencyByAccount: inputs.currencyByAccount,
    accountsByEntity: inputs.accountsByEntity,
    obligations: inputs.obligations,
    pipeline: inputs.pipeline,
    upcomingBuckets: inputs.upcomingBuckets,
    unpaidInvoices: inputs.unpaidInvoices,
    contracts: inputs.contracts,
    accrualWindowStartByContractId: inputs.accrualWindowStartByContractId,
    leaveRows: inputs.leaveRows,
    publicHolidayDatesByEntity: inputs.publicHolidayDatesByEntity,
    includeInvoiceReceipts: true,
    includeAccrual: true,
    recurringPredicate: undefined,
  });

  const incomeByBucket = new Map<string, number>();
  const outflowTotalByBucket = new Map<string, number>();

  for (const e of allEvents) {
    if (e.date < input.from || e.date >= input.to) continue;

    const scope = scopeForAccount(e.account);
    if (input.bucketFilter?.currency !== undefined && input.bucketFilter.currency !== e.currency) {
      continue;
    }
    if (input.bucketFilter?.scope !== undefined && input.bucketFilter.scope !== scope) {
      continue;
    }

    const key = bucketKey(e.currency, scope);
    if (e.amount > 0) {
      incomeByBucket.set(key, (incomeByBucket.get(key) ?? 0) + e.amount);
    } else if (e.amount < 0) {
      outflowTotalByBucket.set(key, (outflowTotalByBucket.get(key) ?? 0) + Math.abs(e.amount));
    }
  }

  return {
    windowFrom: input.from,
    windowTo: input.to,
    incomeByBucket,
    outflowTotalByBucket,
  };
}

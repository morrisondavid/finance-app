/**
 * Aggregate contract income accrual (Contracts tab hero) — pure domain
 * composition shared by `GET /api/contracts/income-accrual` and AI slices.
 */

import {
  AccrualResponseSchema,
  AggregateAccrualEntityRollupSchema,
  AggregateAccrualResponseSchema,
  AggregateAccrualTotalsSchema,
  type AccrualResponse,
  type AggregateAccrualEntityRollup,
  type AggregateAccrualResponse,
  type AggregateAccrualTotals,
  type EntityId,
} from '../../../shared/api-contracts.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { calculateRetainedReserves } from '../../config/tax-rates.js';
import { companyById } from '../company/queries.js';
import { allLeave } from '../leave/index.js';
import { holidayDatesForEntity } from '../working-days/public-holidays.js';
import { computeAccrual } from './income-accrual.js';
import { resolveLastPaymentsForContracts } from './last-payment-resolver.js';
import { allContracts, listContractsForForecast } from './queries.js';

function rollupByEntity(rows: readonly AccrualResponse[]): AggregateAccrualEntityRollup[] {
  const byKey = new Map<
    string,
    {
      issuing_entity_id: EntityId;
      currency: string;
      accrued_to_date: number;
      projected_period_total: number;
      contract_count: number;
    }
  >();

  const contractRegById = new Map(allContracts().map(c => [c.id, c]));
  for (const row of rows) {
    const contract = contractRegById.get(row.contract_id);
    if (contract === undefined) continue;
    const key = `${contract.issuing_entity_id}|${row.currency}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, {
        issuing_entity_id: contract.issuing_entity_id,
        currency: row.currency,
        accrued_to_date: row.accrued_to_date,
        projected_period_total: row.projected_period_total,
        contract_count: 1,
      });
    } else {
      existing.accrued_to_date += row.accrued_to_date;
      existing.projected_period_total += row.projected_period_total;
      existing.contract_count += 1;
    }
  }

  return Array.from(byKey.values()).map(entry => {
    const company = companyById(entry.issuing_entity_id);
    if (company === null) {
      throw new Error(
        `rollupByEntity: no company registered for issuing_entity_id '${entry.issuing_entity_id}' — ` +
          `contract registry gates should have rejected this already`,
      );
    }
    const claim = calculateRetainedReserves(entry.projected_period_total, company);
    return AggregateAccrualEntityRollupSchema.parse({
      ...entry,
      incoming_period_total: claim.incoming_period_total,
      vat_reserve_period: claim.vat_reserve_period,
      ct_reserve_period: claim.ct_reserve_period,
      retained_period: claim.retained_period,
    });
  });
}

/**
 * Cross-entity monthly totals for the Contracts-tab hero tile.
 *
 * Null when the rollup is empty, or when entities disagree on
 * `currency` — summing mixed currencies into a single headline number
 * without FX would silently lie, and cross-currency conversion is
 * Roadmap 3.2's job, not this module's.
 */
function totalsAcrossEntities(
  entities: readonly AggregateAccrualEntityRollup[],
): AggregateAccrualTotals | null {
  if (entities.length === 0) return null;
  const currency = entities[0].currency;
  if (!entities.every(e => e.currency === currency)) return null;

  const base = {
    currency,
    contract_count: 0,
    entity_count: entities.length,
    accrued_to_date: 0,
    projected_period_total: 0,
    incoming_period_total: 0,
    vat_reserve_period: 0,
    ct_reserve_period: 0,
    retained_period: 0,
  };
  for (const e of entities) {
    base.contract_count += e.contract_count;
    base.accrued_to_date += e.accrued_to_date;
    base.projected_period_total += e.projected_period_total;
    base.incoming_period_total += e.incoming_period_total;
    base.vat_reserve_period += e.vat_reserve_period;
    base.ct_reserve_period += e.ct_reserve_period;
    base.retained_period += e.retained_period;
  }
  return AggregateAccrualTotalsSchema.parse(base);
}

/** `today` overridable for tests. */
export interface BuildAggregateAccrualResponseOpts {
  readonly today?: string;
}

export function buildAggregateAccrualResponse(
  opts: BuildAggregateAccrualResponseOpts = {},
): AggregateAccrualResponse {
  const today = opts.today ?? todayIsoLocal();
  // Forecast set, not just strictly-current: a just-ended engagement is still
  // owed for its final unpaid month, so its trailing receivable must surface
  // on the Contracts tab (and AI snapshot) until that payment could land.
  const forecastContracts = listContractsForForecast(today);
  const allLeaveRows = allLeave();
  const lastPayments = resolveLastPaymentsForContracts({
    contracts: forecastContracts,
    today,
  });
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  const perContract = forecastContracts.map(contract => {
    const publicHolidayDates = holidayDatesForEntity(contract.issuing_entity_id, yearStart, yearEnd);
    return AccrualResponseSchema.parse(
      computeAccrual({
        contract,
        leaveRows: allLeaveRows,
        today,
        lastPaymentDate: lastPayments.get(contract.id) ?? null,
        publicHolidayDates,
      }),
    );
  });
  const entities = rollupByEntity(perContract);
  const totals = totalsAcrossEntities(entities);
  return AggregateAccrualResponseSchema.parse({
    today,
    contracts: perContract,
    entities,
    totals,
  });
}

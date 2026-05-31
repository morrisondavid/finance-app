/**
 * Spend/income deltas for household_financial_posture optional block.
 * Reuses grouped expense SQL via `computeSpendRateForWindow` twice.
 */

import { shiftIsoDate, todayIsoLocal } from '../../../shared/iso-date.js';
import type { EntityId, HouseholdFinancialPostureDeltas } from '../../../shared/api-contracts.js';
import { computeSpendRateForWindow } from '../analytics/spend-rate.js';
import { round2 } from '../../utils/math.js';

const DELTA_FLAG_THRESHOLD_PCT = 25;

type Deltas = HouseholdFinancialPostureDeltas;

function deltaPct(current: number, previous: number): number | null {
  if (previous <= 1e-9) return current > 0 ? 100 : null;
  return round2(((current - previous) / previous) * 100);
}

export function composeHouseholdSpendDeltas(
  windowDays: number,
  entityId?: EntityId,
  today: string = todayIsoLocal(),
): Deltas {
  const currentEnd = today;
  const currentStart = shiftIsoDate(today, -(windowDays - 1));
  const previousEnd = shiftIsoDate(currentStart, -1);
  const previousStart = shiftIsoDate(previousEnd, -(windowDays - 1));

  const current = computeSpendRateForWindow(currentStart, currentEnd, entityId);
  const previous = computeSpendRateForWindow(previousStart, previousEnd, entityId);

  const currentTotal = round2(
    current.split.personalDiscretionary +
    current.split.personalMandatory +
    current.split.businessDiscretionary +
    current.split.businessMandatory,
  );
  const previousTotal = round2(
    previous.split.personalDiscretionary +
    previous.split.personalMandatory +
    previous.split.businessDiscretionary +
    previous.split.businessMandatory,
  );

  const categories = [
    ['personalDiscretionary', current.split.personalDiscretionary, previous.split.personalDiscretionary],
    ['personalMandatory', current.split.personalMandatory, previous.split.personalMandatory],
    ['businessDiscretionary', current.split.businessDiscretionary, previous.split.businessDiscretionary],
    ['businessMandatory', current.split.businessMandatory, previous.split.businessMandatory],
  ] as const;

  const byCategory = categories.map(([category, cur, prev]) => {
    const pct = deltaPct(cur, prev);
    return {
      category,
      current: cur,
      previous: prev,
      deltaPct: pct,
      flagged: pct !== null && Math.abs(pct) >= DELTA_FLAG_THRESHOLD_PCT,
    };
  });

  return {
    income: { current: 0, previous: 0, deltaPct: null },
    expenses: {
      current: currentTotal,
      previous: previousTotal,
      deltaPct: deltaPct(currentTotal, previousTotal),
    },
    byCategory,
  };
}

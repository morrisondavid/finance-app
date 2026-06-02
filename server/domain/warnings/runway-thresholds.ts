/**
 * Runway threshold warnings — bridges §1.6 runway calculations onto the
 * §1.8 warnings spine.
 *
 * Three codes:
 *   - `runway-low`           — full-recurring runway < 6 months in any
 *                              headline currency.
 *   - `runway-mandatory-low` — mandatory-only runway < 6 months. Severity
 *                              capped one band higher than full-recurring
 *                              on the same threshold (running out on bills
 *                              only is materially worse than at full
 *                              lifestyle).
 *   - `trapped-cash`         — one currency goes negative inside the
 *                              horizon while another stays positive. Names
 *                              the constraint as "moving money", not
 *                              "earning more".
 *
 * Pure: takes the assembled runway bundle, returns warnings.
 */

import type {
  CurrencyCode,
  EntityFoundationWarning,
  WarningSeverity,
} from '../../../shared/api-contracts.js';
import type { AssembledRunway } from '../forecast/assemble-runway.js';
import { firstNegativeBalanceDate } from '../forecast/runway-metrics.js';

export const RUNWAY_LOW_MONTHS_CRITICAL = 3;
export const RUNWAY_LOW_MONTHS_WARN = 6;
export const RUNWAY_MANDATORY_LOW_MONTHS_WARN = 6;

function severityForFullRunway(months: number): WarningSeverity | null {
  if (months < RUNWAY_LOW_MONTHS_CRITICAL) return 'critical';
  if (months < RUNWAY_LOW_MONTHS_WARN) return 'warn';
  return null;
}

function severityForMandatoryRunway(months: number): WarningSeverity | null {
  // Mandatory-only running out is materially worse — cap one band higher.
  if (months < RUNWAY_LOW_MONTHS_CRITICAL) return 'critical';
  if (months < RUNWAY_MANDATORY_LOW_MONTHS_WARN) return 'critical';
  return null;
}

function emitRunwayLow(
  currency: CurrencyCode,
  months: number,
  firstStressDate: string,
  household: AssembledRunway['household'],
): EntityFoundationWarning | null {
  const severity = severityForFullRunway(months);
  if (severity === null) return null;
  const block =
    currency === 'GBP' ? household.GBP : currency === 'AED' ? household.AED : undefined;
  return {
    id: `runway-low:${currency}`,
    code: 'runway-low',
    severity,
    title: `${currency} runway is ${months.toFixed(1)} months at full lifestyle`,
    detail:
      `Household ${currency} runway hits zero on ${firstStressDate} if active income stops today, ` +
      `with cash ${block?.totalCashCurrent ?? 0} and available credit ${block?.totalAvailableCredit ?? 0} carrying you. ` +
      `Threshold for ${severity}: < ${severity === 'critical' ? RUNWAY_LOW_MONTHS_CRITICAL : RUNWAY_LOW_MONTHS_WARN} months.`,
    recommended_action:
      severity === 'critical'
        ? `Find new income or cut discretionary spend immediately — at this rate ${currency} runs out in ${months.toFixed(1)} months.`
        : `Plan a runway extension: new income, reduced spend, or moving money from another currency. ${months.toFixed(1)} months is comfortable today but tight if a contract slips.`,
    sources: [`currency:${currency}`, 'forecast:runway'],
    context: {
      currency,
      runwayMonthsFullRecurring: months,
      firstStressDate,
      totalCashCurrent: block?.totalCashCurrent ?? 0,
      totalAvailableCredit: block?.totalAvailableCredit ?? 0,
      threshold: severity === 'critical' ? RUNWAY_LOW_MONTHS_CRITICAL : RUNWAY_LOW_MONTHS_WARN,
    },
  };
}

function emitRunwayMandatoryLow(
  currency: CurrencyCode,
  months: number,
  firstStressDate: string,
  household: AssembledRunway['household'],
): EntityFoundationWarning | null {
  const severity = severityForMandatoryRunway(months);
  if (severity === null) return null;
  const block =
    currency === 'GBP' ? household.GBP : currency === 'AED' ? household.AED : undefined;
  return {
    id: `runway-mandatory-low:${currency}`,
    code: 'runway-mandatory-low',
    severity,
    title: `${currency} runway on bills-only is ${months.toFixed(1)} months`,
    detail:
      `Even cutting QoL spend, household ${currency} hits zero on ${firstStressDate} if active income stops. ` +
      `Cash ${block?.totalCashCurrent ?? 0}, available credit ${block?.totalAvailableCredit ?? 0}.`,
    recommended_action:
      `Bills-only is the floor; running out on this lane means renegotiating mortgages / selling / drawing credit. ` +
      `Treat this as a hard deadline — ${firstStressDate} is when it bites.`,
    sources: [`currency:${currency}`, 'forecast:runway'],
    context: {
      currency,
      runwayMonthsMandatoryRecurring: months,
      firstStressDate,
      totalCashCurrent: block?.totalCashCurrent ?? 0,
      totalAvailableCredit: block?.totalAvailableCredit ?? 0,
      threshold: RUNWAY_MANDATORY_LOW_MONTHS_WARN,
    },
  };
}

/**
 * Emit `trapped-cash` when one currency goes negative inside the horizon
 * while another stays solvent throughout. The signal names the
 * constraint as "moving money is the constraint, not earning more".
 *
 * Only fires when there are >= 2 currencies in play AND they diverge.
 */
function emitTrappedCash(
  assembled: AssembledRunway,
): EntityFoundationWarning | null {
  const negatives = new Map<CurrencyCode, string>();
  const positives: CurrencyCode[] = [];
  for (const [currency, daily] of assembled.fullRecurring.mergedByCurrency) {
    const stress = firstNegativeBalanceDate(daily);
    if (stress !== null) negatives.set(currency, stress);
    else positives.push(currency);
  }
  if (negatives.size === 0 || positives.length === 0) return null;

  const stressedList = [...negatives.entries()].map(([c, d]) => `${c} (${d})`).join(', ');
  const solventList = positives.join(', ');

  // The first stressed currency drives the warning's identity; if both
  // stress, alphabetical for stable id.
  const firstStressedCurrency = [...negatives.keys()].sort()[0];
  const firstStressDate = negatives.get(firstStressedCurrency)!;

  return {
    id: `trapped-cash:${firstStressedCurrency}`,
    code: 'trapped-cash',
    severity: 'warn',
    title: `Trapped cash: ${stressedList} runs out while ${solventList} stays solvent`,
    detail:
      `One currency goes negative inside the runway horizon while another stays positive throughout. ` +
      `Moving money between accounts (or entities) is the constraint, not earning more.`,
    recommended_action:
      `Plan an inter-currency transfer well before ${firstStressDate}. Look at FX cost, timing, and any tax implications of moving money between entities.`,
    sources: [...negatives.keys(), ...positives].map(c => `currency:${c}`).concat(['forecast:runway']),
    context: {
      stressedCurrency: firstStressedCurrency,
      stressedDate: firstStressDate,
      solventCurrencies: positives.join(','),
    },
  };
}

export function deriveRunwayThresholdWarnings(
  assembled: AssembledRunway,
): EntityFoundationWarning[] {
  const out: EntityFoundationWarning[] = [];

  for (const currency of ['GBP', 'AED'] as const) {
    const block = assembled.household[currency];
    if (block === undefined) continue;
    if (block.runwayMonthsFullRecurring !== null && block.firstStressDateFullRecurring !== null) {
      const w = emitRunwayLow(
        currency,
        block.runwayMonthsFullRecurring,
        block.firstStressDateFullRecurring,
        assembled.household,
      );
      if (w !== null) out.push(w);
    }
    if (block.runwayMonthsMandatoryRecurring !== null && block.firstStressDateMandatoryRecurring !== null) {
      const w = emitRunwayMandatoryLow(
        currency,
        block.runwayMonthsMandatoryRecurring,
        block.firstStressDateMandatoryRecurring,
        assembled.household,
      );
      if (w !== null) out.push(w);
    }
  }

  const trapped = emitTrappedCash(assembled);
  if (trapped !== null) out.push(trapped);

  return out;
}

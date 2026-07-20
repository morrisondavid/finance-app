/**
 * Bridge from §1.7's typed `RiskSignal` discriminated union to a
 * §1.8 `Warning` row.
 *
 * Single source of prose for income-composition warnings: every
 * `title` / `detail` / `recommended_action` string for these codes is
 * synthesised here, from primitives. The same primitives are preserved
 * verbatim on the warning's `context` map so AI / future surfaces can
 * read them without parsing strings (the smell flagged in §1.7's
 * audit findings).
 *
 * Pure: takes a signal, returns a warning. No I/O.
 */

import type {
  EntityFoundationWarning,
  WarningSeverity,
} from '../../../shared/api-contracts.js';
import type { RiskSignal, RiskSeverity } from '../income-composition/risk-signals.js';

function mapSeverity(s: RiskSeverity): WarningSeverity {
  return s === 'high' ? 'critical' : 'warn';
}

function fmtMoney(currency: string, amount: number): string {
  // Match the dashboard's preferred display: GBP £, AED AED.
  const symbol = currency === 'GBP' ? '£' : `${currency} `;
  return `${symbol}${amount.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function pctOf(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Stable identity for a risk-signal warning so the same conceptual
 * warning round-trips between snapshots even if `id` changes.
 */
function buildId(signal: RiskSignal): string {
  switch (signal.code) {
    case 'leveraged-passive-income':
      return `${signal.code}:${signal.propertyId}`;
    case 'passive-income-zero':
    case 'mode-concentration-extreme':
      return `${signal.code}:${signal.currency}`;
    case 'client-concentration-extreme':
    case 'client-concentration-elevated':
      return `${signal.code}:${signal.currency}:${signal.topClientId}`;
    case 'time-independence-low':
    case 'time-independence-elevated':
      return `${signal.code}:${signal.currency}`;
  }
}

function buildSources(signal: RiskSignal): string[] {
  switch (signal.code) {
    case 'leveraged-passive-income':
      return [`property:${signal.propertyId}`, 'income-composition'];
    case 'client-concentration-extreme':
    case 'client-concentration-elevated':
      return [`client:${signal.topClientId}`, `currency:${signal.currency}`, 'income-composition'];
    default:
      return [`currency:${signal.currency}`, 'income-composition'];
  }
}

/**
 * Convert a 1.7 `RiskSignal` into the §1.8 `Warning` shape.
 *
 * Preserves every primitive on `context`. Synthesises the existing
 * `title` / `detail` / `recommended_action` strings so the live UI
 * (which reads them directly) renders the new entries with no client
 * change.
 */
export function formatRiskSignalAsWarning(signal: RiskSignal): EntityFoundationWarning {
  switch (signal.code) {
    case 'client-concentration-extreme':
    case 'client-concentration-elevated': {
      const severity = mapSeverity(signal.severity);
      const isExtreme = signal.code === 'client-concentration-extreme';
      return {
        id: buildId(signal),
        code: signal.code,
        severity,
        title: isExtreme
          ? `Client concentration is extreme in ${signal.currency} (${pctOf(signal.ratio)})`
          : `Client concentration is elevated in ${signal.currency} (${pctOf(signal.ratio)})`,
        detail:
          `${signal.topClientId} accounts for ${pctOf(signal.ratio)} of active income in ${signal.currency} ` +
          `(${fmtMoney(signal.currency, signal.topClientMonthly)} of ${fmtMoney(signal.currency, signal.totalActiveMonthly)} per month). ` +
          `Threshold for ${isExtreme ? 'extreme' : 'elevated'}: ${pctOf(signal.threshold)}.`,
        recommended_action: isExtreme
          ? `Add another active client in ${signal.currency} or grow passive income — losing ${signal.topClientId} would erase the bulk of this entity's income.`
          : `Track ${signal.topClientId}'s renewal carefully and look for a second client to bring concentration below ${pctOf(signal.threshold)}.`,
        sources: buildSources(signal),
        context: {
          ratio: signal.ratio,
          topClientId: signal.topClientId,
          topClientMonthly: signal.topClientMonthly,
          totalActiveMonthly: signal.totalActiveMonthly,
          threshold: signal.threshold,
          currency: signal.currency,
        },
      };
    }

    case 'time-independence-low':
    case 'time-independence-elevated': {
      const severity = mapSeverity(signal.severity);
      const isLow = signal.code === 'time-independence-low';
      return {
        id: buildId(signal),
        code: signal.code,
        severity,
        title: isLow
          ? `Time-independence is low in ${signal.currency} (${pctOf(signal.ratio)})`
          : `Time-independence is below target in ${signal.currency} (${pctOf(signal.ratio)})`,
        detail:
          `Passive income covers ${pctOf(signal.ratio)} of mandatory outgoings in ${signal.currency} ` +
          `(${fmtMoney(signal.currency, signal.passiveMonthly)} of ${fmtMoney(signal.currency, signal.mandatoryMonthly)} per month). ` +
          `Target ${pctOf(signal.targetRatio)} — to reach it, add ${fmtMoney(signal.currency, signal.additionalPassiveNeeded)} ` +
          `passive monthly OR cut mandatory outgoings by ${fmtMoney(signal.currency, signal.mandatoryReductionNeeded)}.`,
        recommended_action: isLow
          ? `Active income is doing nearly all the work. Grow passive sources or shrink mandatory bills — the math is in this row's context.`
          : `You're on the path; closing the gap of ${fmtMoney(signal.currency, signal.additionalPassiveNeeded)} per month gets you to ${pctOf(signal.targetRatio)}.`,
        sources: buildSources(signal),
        context: {
          ratio: signal.ratio,
          passiveMonthly: signal.passiveMonthly,
          mandatoryMonthly: signal.mandatoryMonthly,
          targetRatio: signal.targetRatio,
          additionalPassiveNeeded: signal.additionalPassiveNeeded,
          mandatoryReductionNeeded: signal.mandatoryReductionNeeded,
          currency: signal.currency,
        },
      };
    }

    case 'mode-concentration-extreme': {
      return {
        id: buildId(signal),
        code: signal.code,
        severity: 'critical',
        title: `Income is almost entirely active in ${signal.currency} (${pctOf(signal.activeShare)})`,
        detail:
          `${pctOf(signal.activeShare)} of total income in ${signal.currency} comes from sources that require you to show up. ` +
          `Threshold: ${pctOf(signal.threshold)}.`,
        recommended_action:
          `Build at least one passive stream in ${signal.currency} so income survives a stretch of you not working.`,
        sources: buildSources(signal),
        context: {
          activeShare: signal.activeShare,
          passiveShare: signal.passiveShare,
          totalMonthly: signal.totalMonthly,
          threshold: signal.threshold,
          currency: signal.currency,
        },
      };
    }

    case 'passive-income-zero': {
      return {
        id: buildId(signal),
        code: signal.code,
        severity: 'critical',
        title: `No passive income in ${signal.currency}`,
        detail:
          `Mandatory outgoings of ${fmtMoney(signal.currency, signal.mandatoryMonthly)} per month in ${signal.currency} ` +
          `with zero passive income to fall back on.`,
        recommended_action: `Establish at least one passive stream in ${signal.currency} so a pause in active work isn't immediate.`,
        sources: buildSources(signal),
        context: {
          passiveMonthly: signal.passiveMonthly,
          mandatoryMonthly: signal.mandatoryMonthly,
          currency: signal.currency,
        },
      };
    }

    case 'leveraged-passive-income': {
      return {
        id: buildId(signal),
        code: signal.code,
        severity: 'info',
        title: `Property ${signal.propertyId} contributes only ${pctOf(signal.netToGrossRatio)} of its rent as net cash`,
        detail:
          `Gross rent ${fmtMoney('GBP', signal.grossMonthly)}/mo less mortgage ${fmtMoney('GBP', signal.mortgageMonthly)}/mo ` +
          `leaves ${fmtMoney('GBP', signal.netMonthly)}/mo (${pctOf(signal.netToGrossRatio)}). ` +
          `Threshold for ${signal.severity}: net/gross < ${pctOf(signal.threshold)}.`,
        recommended_action:
          `Watch ${signal.propertyId}'s rate-reset date; the leverage is high enough that small movements move the net cash a lot.`,
        sources: buildSources(signal),
        context: {
          propertyId: signal.propertyId,
          grossMonthly: signal.grossMonthly,
          mortgageMonthly: signal.mortgageMonthly,
          netMonthly: signal.netMonthly,
          netToGrossRatio: signal.netToGrossRatio,
          threshold: signal.threshold,
        },
      };
    }
  }
}

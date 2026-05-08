/**
 * §3.2 — AI spend-by-currency slice (orchestrator-facing).
 */

import type { AccountName, AiSpendByCurrencyPeriod, AiSpendByCurrencyResponse, EntityId } from '../../../shared/api-contracts.js';
import { AiSpendByCurrencyResponseSchema } from '../../../shared/api-contracts.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { buildSpendTotalsByCurrency } from '../cross-currency/spend-by-currency.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';

export interface ComposeAiSpendByCurrencyOpts {
  readonly period: AiSpendByCurrencyPeriod;
  readonly entityId?: EntityId;
  readonly account?: AccountName;
}

/** MCP / defaults: calendar month containing `todayIso` (YYYY-MM-DD). */
export function defaultSpendByCurrencyPeriodFromTodayIso(todayIso: string): AiSpendByCurrencyPeriod {
  return { kind: 'calendarMonth', yearMonth: todayIso.slice(0, 7) };
}

export function composeAiSpendByCurrency(opts: ComposeAiSpendByCurrencyOpts): AiSpendByCurrencyResponse {
  const { totalsByCurrency, fxNote } = buildSpendTotalsByCurrency({
    period:
      opts.period.kind === 'calendarMonth'
        ? { kind: 'calendarMonth', yearMonth: opts.period.yearMonth }
        : { kind: 'financialYear', financialYear: opts.period.financialYear },
    entityId: opts.entityId,
    account: opts.account,
  });

  return AiSpendByCurrencyResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
    period: opts.period,
    filters: { entityId: opts.entityId, account: opts.account },
    totalsByCurrency,
    fxNote,
  });
}

export function composeAiSpendByCurrencyForCurrentMonth(): AiSpendByCurrencyResponse {
  return composeAiSpendByCurrency({
    period: defaultSpendByCurrencyPeriodFromTodayIso(todayIsoLocal()),
  });
}

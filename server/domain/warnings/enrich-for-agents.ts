/**
 * §2.3 — enrich consolidated warnings for agents / MCP (fingerprint, links, urgency, action hints, user state).
 */

import type Database from 'better-sqlite3';
import type {
  EntityFoundationWarning,
  EntityFoundationWarningCode,
  WarningActionHint,
  WarningLinks,
  WarningUrgency,
  WarningUserState,
} from '../../../shared/api-contracts.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { fingerprintWarning, getFingerprintTimeline } from './snapshots.js';

function ctxStr(ctx: Record<string, unknown> | undefined, key: string): string | null {
  if (!ctx) return null;
  const v = ctx[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function ctxNum(ctx: Record<string, unknown> | undefined, key: string): number | null {
  if (!ctx) return null;
  const v = ctx[key];
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}

export function extractWarningLinks(w: EntityFoundationWarning): WarningLinks {
  const c = w.context as Record<string, unknown> | undefined;
  const links: WarningLinks = {};
  const assign = (field: keyof WarningLinks, contextKey: string) => {
    const s = ctxStr(c, contextKey);
    if (s !== null) {
      (links as Record<string, string>)[field] = s;
    }
  };
  assign('obligationId', 'obligationId');
  assign('contractId', 'contractId');
  assign('invoiceId', 'invoiceId');
  assign('debtId', 'debtId');
  assign('planId', 'planId');
  assign('movementId', 'movementId');
  return links;
}

export function deriveWarningUrgency(w: EntityFoundationWarning): WarningUrgency {
  const c = w.context as Record<string, unknown> | undefined;
  const daysOverdue = ctxNum(c, 'daysOverdue');
  const dueDate = ctxStr(c, 'dueDate');
  const firstStress =
    ctxStr(c, 'firstStressDate') ??
    ctxStr(c, 'firstStressDateFullRecurring') ??
    ctxStr(c, 'stressedDate');

  if (daysOverdue !== null && daysOverdue > 0) {
    return { band: 'overdue', daysOverdue, dueDate: dueDate ?? null, stressDate: firstStress ?? null };
  }
  if (dueDate !== null) {
    const today = todayIsoLocal();
    if (dueDate <= today) {
      return { band: 'overdue', dueDate, daysOverdue: daysOverdue ?? null, stressDate: firstStress ?? null };
    }
    const ms = Date.parse(dueDate) - Date.parse(today);
    if (!Number.isNaN(ms)) {
      const days = ms / 86_400_000;
      if (days <= 14) {
        return { band: 'due_soon', dueDate, daysOverdue: null, stressDate: firstStress ?? null };
      }
    }
  }
  if (firstStress !== null) {
    return {
      band: 'stress_soon',
      stressDate: firstStress,
      dueDate: dueDate ?? null,
      daysOverdue: daysOverdue ?? null,
    };
  }
  if (w.severity === 'critical') {
    return { band: 'stress_soon', stressDate: null, dueDate: dueDate ?? null, daysOverdue: daysOverdue ?? null };
  }
  if (w.severity === 'warn') {
    return { band: 'due_soon', dueDate: dueDate ?? null, daysOverdue: null, stressDate: firstStress ?? null };
  }
  return {
    band: 'routine',
    dueDate: dueDate ?? null,
    daysOverdue: daysOverdue ?? null,
    stressDate: firstStress ?? null,
  };
}

const HINT_BY_PREFIX: { prefix: string; hints: WarningActionHint[] }[] = [
  { prefix: 'invoice-', hints: ['reconcile_invoices'] },
  { prefix: 'plan-', hints: ['open_debt_strategy'] },
  { prefix: 'runway-', hints: ['review_runway_forecast', 'review_budgets'] },
  { prefix: 'trapped-', hints: ['review_runway_forecast', 'classify_transactions'] },
  { prefix: 'tax-reserve-', hints: ['review_tax_reserve', 'open_obligations'] },
  { prefix: 'company-', hints: ['review_company_settings'] },
  { prefix: 'client-', hints: ['review_clients'] },
  { prefix: 'contract-', hints: ['review_contracts'] },
  { prefix: 'inter-company-', hints: ['classify_transactions'] },
  { prefix: 'payment-outside-', hints: ['review_contracts', 'reconcile_invoices'] },
  { prefix: 'mortgage-', hints: ['open_obligations'] },
  { prefix: 'ad-hoc-', hints: ['review_budgets'] },
  { prefix: 'debt-', hints: ['open_debt_strategy'] },
  { prefix: 'account-credit-', hints: ['open_debt_strategy', 'review_company_settings'] },
  { prefix: 'fzco-', hints: ['review_company_settings', 'open_obligations'] },
  { prefix: 'ifza-', hints: ['open_deadlines'] },
];

const CODE_EXTRA: Partial<Record<EntityFoundationWarningCode, WarningActionHint[]>> = {
  'warning-improved': [],
  'warning-cleared': [],
};

export function actionHintsForWarningCode(code: EntityFoundationWarningCode): WarningActionHint[] {
  const extra = CODE_EXTRA[code];
  if (extra !== undefined) return [...extra];
  for (const { prefix, hints } of HINT_BY_PREFIX) {
    if (code.startsWith(prefix)) return [...hints];
  }
  if (code.includes('concentration') || code.includes('independence')) {
    return ['review_clients', 'review_contracts'];
  }
  return ['open_obligations'];
}

export function enrichWarningsForAgents(
  db: Database.Database,
  warnings: readonly EntityFoundationWarning[],
  userStateByFp: ReadonlyMap<string, WarningUserState>,
): EntityFoundationWarning[] {
  return warnings.map(w => enrichOneWarning(db, w, userStateByFp));
}

function enrichOneWarning(
  db: Database.Database,
  w: EntityFoundationWarning,
  userStateByFp: ReadonlyMap<string, WarningUserState>,
): EntityFoundationWarning {
  const { fingerprint: _fp, links: _l, urgency: _u, actionHints: _a, ...base } = w;
  const fingerprint = fingerprintWarning(base);
  const timeline = getFingerprintTimeline(db, fingerprint);
  const linksRaw = extractWarningLinks(base);
  const hasLinks = Object.keys(linksRaw).length > 0;
  const userState = userStateByFp.get(fingerprint);
  const hasUserState =
    userState !== undefined &&
    (userState.snoozedUntil !== undefined ||
      userState.acknowledgedAt !== undefined ||
      userState.surface !== undefined);

  return {
    ...base,
    fingerprint,
    ...(hasLinks ? { links: linksRaw } : {}),
    urgency: deriveWarningUrgency(base),
    actionHints: actionHintsForWarningCode(base.code),
    ...(timeline.firstSeenAt !== null ? { firstSeenAt: timeline.firstSeenAt } : {}),
    ...(timeline.lastActiveAt !== null ? { lastActiveAt: timeline.lastActiveAt } : {}),
    ...(hasUserState ? { userState } : {}),
  };
}

/**
 * Whether a warning appears in the Warnings tab / consolidated listing feed.
 *
 * Snooze hides until `snoozedUntil` is before today. Snapshot-diff meta entries
 * (`warning-cleared`, `warning-improved`) are recorded for timeline history but
 * are not actionable signals — suppress them from the listing so fixed false
 * positives do not clutter the feed.
 */
export function warningPassesListingFilter(w: EntityFoundationWarning, todayIso: string): boolean {
  if (w.code === 'warning-cleared' || w.code === 'warning-improved') {
    return false;
  }
  const untilRaw = w.userState?.snoozedUntil;
  if (untilRaw === undefined || untilRaw === null || untilRaw === '') return true;
  const untilDay = untilRaw.slice(0, 10);
  const todayDay = todayIso.slice(0, 10);
  return untilDay < todayDay;
}

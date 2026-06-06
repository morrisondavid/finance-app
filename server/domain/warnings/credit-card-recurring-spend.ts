/**
 * Warn when monthly recurring expenses are charged to a credit card whose
 * configured terms make carrying routine spend expensive (high minimum
 * payment % and/or high standard APR). Paying from a debit/current account
 * avoids inflating the card balance and the direct-debit minimum repayments.
 *
 * Generic across all credit-card accounts — not Capital on Tap specific.
 * Only fires when `creditCard` terms are configured (otherwise the
 * `account-credit-card-config-missing` warning covers the gap).
 */

import type { EntityFoundationWarning, RecurringExpense } from '../../../shared/api-contracts.js';
import {
  COSTLY_REVOLVING_MIN_PAYMENT_PCT,
  COSTLY_REVOLVING_STANDARD_APR,
  effectiveMinPaymentPct,
  fmtAprPct,
  fmtMinPaymentPct,
  isCostlyRevolvingCreditCard,
  preferredOutgoingAccountForCard,
} from '../accounts/credit-card-terms.js';
import type { AccountConfig } from '../accounts/schema.js';
import type { PipelineResult } from '../../utils/recurring-pipeline.js';
import { SPECIAL_CATEGORY } from '../../utils/category-constants.js';

const EXCLUDED_CATEGORIES = new Set<string>([
  SPECIAL_CATEGORY.debtRepayment,
  SPECIAL_CATEGORY.transfers,
]);

export interface DeriveCreditCardRecurringSpendWarningsInput {
  readonly accounts: readonly AccountConfig[];
  readonly pipeline: PipelineResult;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isActionableRecurringLine(item: RecurringExpense): boolean {
  if (item.frequency !== 'monthly') return false;
  if (EXCLUDED_CATEGORIES.has(item.category)) return false;
  if (item.amount <= 0) return false;
  return true;
}

function groupRecurringByCreditCard(
  accounts: readonly AccountConfig[],
  pipeline: PipelineResult,
): Map<string, { account: AccountConfig; lines: RecurringExpense[] }> {
  const cardByName = new Map<string, AccountConfig>();
  for (const acc of accounts) {
    if (acc.type !== 'credit-card') continue;
    if (acc.creditCard === undefined) continue;
    if (!isCostlyRevolvingCreditCard(acc.creditCard)) continue;
    cardByName.set(acc.name, acc);
  }

  const grouped = new Map<string, RecurringExpense[]>();
  for (const item of pipeline.monthlyExpenseRecurring) {
    if (!isActionableRecurringLine(item)) continue;
    const card = cardByName.get(item.sourceAccount);
    if (card === undefined) continue;
    const lines = grouped.get(item.sourceAccount) ?? [];
    lines.push(item);
    grouped.set(item.sourceAccount, lines);
  }

  const out = new Map<string, { account: AccountConfig; lines: RecurringExpense[] }>();
  for (const [name, lines] of grouped) {
    const account = cardByName.get(name);
    if (account === undefined || lines.length === 0) continue;
    out.set(name, { account, lines });
  }
  return out;
}

function formatMerchantSummary(lines: readonly RecurringExpense[]): string {
  const sorted = [...lines].sort((a, b) => b.amount - a.amount);
  const parts = sorted.slice(0, 6).map(l => `${l.merchant} (£${round2(l.amount)}/mo)`);
  if (sorted.length > 6) {
    parts.push(`+${sorted.length - 6} more`);
  }
  return parts.join(', ');
}

export function deriveCreditCardRecurringSpendWarnings(
  input: DeriveCreditCardRecurringSpendWarningsInput,
): EntityFoundationWarning[] {
  const grouped = groupRecurringByCreditCard(input.accounts, input.pipeline);
  const out: EntityFoundationWarning[] = [];

  for (const { account, lines } of grouped.values()) {
    const terms = account.creditCard;
    if (terms === undefined) continue;

    const preferred = preferredOutgoingAccountForCard(account, input.accounts);
    const monthlyTotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
    const minPct = effectiveMinPaymentPct(terms);
    const merchantSummary = formatMerchantSummary(lines);

    const costlyReason =
      minPct >= COSTLY_REVOLVING_MIN_PAYMENT_PCT && terms.standardApr >= COSTLY_REVOLVING_STANDARD_APR
        ? `${fmtAprPct(terms.standardApr)} APR and ${fmtMinPaymentPct(minPct)} minimum payments`
        : minPct >= COSTLY_REVOLVING_MIN_PAYMENT_PCT
          ? `${fmtMinPaymentPct(minPct)} minimum payments`
          : `${fmtAprPct(terms.standardApr)} APR`;

    const payFrom =
      preferred !== null
        ? `${preferred.label} (${preferred.name})`
        : 'a debit or current account instead of this card';

    out.push({
      id: `credit-card-recurring-spend:${account.name}`,
      code: 'credit-card-recurring-spend',
      severity: 'warn',
      entityId: account.category === 'business' ? account.entityId : undefined,
      title: `Move recurring bills off ${account.label}`,
      detail:
        `${lines.length} monthly recurring charge${lines.length === 1 ? '' : 's'} totalling ` +
        `£${monthlyTotal}/mo are going through ${account.label}. That card carries ${costlyReason}, ` +
        `so routine spend increases your balance and the minimum repayments you must make — ` +
        `interest accrues whenever the statement isn't cleared in full. ` +
        `Detected: ${merchantSummary}.`,
      recommended_action:
        `Where possible, retarget these standing orders/subscriptions to ${payFrom}. ` +
        `Reserve credit cards for one-off spend you intend to clear, not monthly bills.`,
      sources: [`account:${account.name}`, 'recurring-pipeline', 'credit-card-recurring-spend'],
      context: {
        account: account.name,
        label: account.label,
        merchantCount: lines.length,
        monthlyTotalGbp: monthlyTotal,
        standardApr: terms.standardApr,
        minPaymentPct: minPct,
        preferredAccount: preferred?.name ?? '',
        merchants: lines.map(l => l.merchant).join(', '),
      },
    });
  }

  out.sort((a, b) => {
    const aVal =
      typeof a.context?.monthlyTotalGbp === 'number' ? a.context.monthlyTotalGbp : 0;
    const bVal =
      typeof b.context?.monthlyTotalGbp === 'number' ? b.context.monthlyTotalGbp : 0;
    return bVal - aVal;
  });
  return out;
}

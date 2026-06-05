/**
 * Debt-unregistered detector (§1.9).
 *
 * Surfaces recurring expenses that match common credit-provider /
 * BNPL / branded-finance patterns but aren't covered by any active
 * `debts.csv` row. Emits `debt-unregistered` (info) per detected
 * merchant so the user can register it with full terms — otherwise
 * the avalanche / snowball / consolidation math silently misses it.
 *
 * Reuses `computeBudgetNudges` to get the merchant-bucketed view of
 * recurring expenses, then filters by the credit-provider patterns.
 * Same template as §1.8's `ad-hoc-spend.ts`.
 */

import type { EntityFoundationWarning } from '../../../shared/api-contracts.js';
import type { Debt } from '../../db/repositories/debts.js';
import type { PipelineResult, RawTransaction } from '../../utils/recurring-pipeline.js';
import { computeBudgetNudges } from '../../utils/budget-nudges.js';

/**
 * Curated list of credit-provider patterns. Substring match,
 * case-insensitive. Add new entries as the user encounters them.
 */
export const CREDIT_PROVIDER_PATTERNS: readonly string[] = [
  'KLARNA',
  'PAYPAL PAY IN 3',
  'PAYPAL PAY IN 4',
  'AFFIRM',
  'CARFINANCE247',
  'TESCO BANK LOANS',
  'ZILCH',
  'CLEARPAY',
  'MONEYBARN',
  'LIKEWIZE',
];

export interface DeriveDebtUnregisteredWarningsInput {
  readonly expenseTransactions: readonly RawTransaction[];
  readonly pipeline: PipelineResult;
  readonly budgetedCategories: ReadonlySet<string>;
  /** All known debts (active + archived). Used to filter out merchants already covered by a debt's `merchant_pattern`. */
  readonly debts: readonly Debt[];
}

function merchantMatchesProviderPattern(merchant: string): string | null {
  const m = merchant.toUpperCase();
  for (const pat of CREDIT_PROVIDER_PATTERNS) {
    if (m.includes(pat.toUpperCase())) return pat;
  }
  return null;
}

function isCoveredByExistingDebt(merchant: string, debts: readonly Debt[]): boolean {
  const m = merchant.toLowerCase();
  for (const d of debts) {
    if (d.archived) continue;
    if (m.includes(d.merchantPattern.toLowerCase())) return true;
  }
  return false;
}

export function deriveDebtUnregisteredWarnings(
  input: DeriveDebtUnregisteredWarningsInput,
): EntityFoundationWarning[] {
  // Reuse the existing budget-nudges merchant aggregator: it already
  // groups recurring transactions by merchant with totalSpend +
  // suggestedCategory + lastDate. The minimum threshold is 0 here so
  // we don't miss small unregistered-credit lines.
  const nudges = computeBudgetNudges({
    expenseTransactions: input.expenseTransactions,
    pipeline: input.pipeline,
    budgetedCategories: input.budgetedCategories,
    activeDebts: input.debts,
    options: { minTotal: 0, maxRows: 100 },
  });

  const out: EntityFoundationWarning[] = [];
  for (const nudge of nudges) {
    const matchedPattern = merchantMatchesProviderPattern(nudge.merchant);
    if (matchedPattern === null) continue;
    if (isCoveredByExistingDebt(nudge.merchant, input.debts)) continue;

    out.push({
      id: `debt-unregistered:${nudge.merchant}`,
      code: 'debt-unregistered',
      severity: 'info',
      title: `Possibly-unregistered credit account: ${nudge.merchant}`,
      detail:
        `Recurring expense matching the credit-provider pattern '${matchedPattern}' detected ` +
        `(${nudge.transactionCount} transactions totalling £${nudge.totalSpend} across the recent window, ` +
        `last seen ${nudge.lastDate}). No active debt in debts.csv covers this merchant — the ` +
        `payoff / refinance / consolidation math will silently miss it until you register it.`,
      recommended_action:
        `Add a row to debts.csv (or via the Debts tab) with the lender's actual terms: ` +
        `originalLoanAmount, openingBalance, interestRate, repaymentType, fixedRateEndDate.`,
      sources: [`merchant:${nudge.merchant}`, 'budget-nudges', 'debt-unregistered'],
      context: {
        merchant: nudge.merchant,
        matchedPattern,
        suggestedCategory: nudge.suggestedCategory,
        recentTotalSpend: nudge.totalSpend,
        transactionCount: nudge.transactionCount,
        lastDate: nudge.lastDate,
      },
    });
  }
  return out;
}

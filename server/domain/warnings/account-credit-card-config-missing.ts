/**
 * Surfaces credit-card accounts that don't have a `creditCard` config
 * block populated (§1.9). Without it, the planner refuses to model
 * "move debt to this card" plans (better silent than wrong) — this
 * warning gives the user a path to fill in the gap.
 *
 * Auto-clears via the existing §1.8 snapshot diff once the user adds
 * the config and the warning stops firing.
 *
 * Pure: caller passes the account configs.
 */

import type { EntityFoundationWarning } from '../../../shared/api-contracts.js';
import type { AccountConfig } from '../accounts/schema.js';

export interface DeriveAccountCreditCardConfigMissingInput {
  readonly accounts: readonly AccountConfig[];
}

export function deriveAccountCreditCardConfigMissingWarnings(
  input: DeriveAccountCreditCardConfigMissingInput,
): EntityFoundationWarning[] {
  const out: EntityFoundationWarning[] = [];
  for (const acc of input.accounts) {
    if (acc.type !== 'credit-card') continue;
    if (acc.creditCard !== undefined) continue;
    out.push({
      id: `account-credit-card-config-missing:${acc.name}`,
      code: 'account-credit-card-config-missing',
      severity: 'info',
      title: `${acc.label} has no credit-card terms configured`,
      detail:
        `${acc.label} is a credit-card account but no APR / promo / fee terms are configured. ` +
        `Without these, the §1.9 Debt Strategy planner can't model "move debt onto this card" ` +
        `plans honestly. Refinance comparisons against this card are suppressed until you fill ` +
        `in the AccountConfig.creditCard block.`,
      recommended_action:
        `Edit server/domain/accounts/data.ts to add a creditCard block to '${acc.name}': ` +
        `{ standardApr, minPaymentPct?, minPaymentFloorGbp?, promo?: { apr, expiresAt, transferFeePct, minPaymentPct, minPaymentTerminatesPromo } }.`,
      sources: [`account:${acc.name}`, 'account-credit-card-config-missing'],
      context: {
        account: acc.name,
        label: acc.label,
        currency: acc.currency,
      },
    });
  }
  return out;
}

/**
 * Surfaces blocked FZCO save-for-target plans (§1.9).
 *
 * v1 doesn't support FZCO save-for-target plans (no AED savings
 * account). When the user attempts one (route returns this from
 * `generatePlan`), we emit this warning and refuse to persist.
 *
 * Pure: caller passes the recent block events (one entry per failed
 * attempt). The orchestrator-side route catches blocks and forwards
 * them here.
 */

import type { EntityFoundationWarning } from '../../../shared/api-contracts.js';

export interface FzcoBlockedAttempt {
  /** Stable key per attempted plan creation — used as the warning id. */
  readonly attemptKey: string;
  readonly displayName: string;
  /** ISO date when the attempt happened. */
  readonly attemptedAt: string;
}

export interface DerivePlanBlockedFzcoNoSavingsAccountInput {
  readonly recentBlockedAttempts: readonly FzcoBlockedAttempt[];
}

export function derivePlanBlockedFzcoNoSavingsAccountWarnings(
  input: DerivePlanBlockedFzcoNoSavingsAccountInput,
): EntityFoundationWarning[] {
  return input.recentBlockedAttempts.map(att => ({
    id: `plan-blocked-fzco-no-savings-account:${att.attemptKey}`,
    code: 'plan-blocked-fzco-no-savings-account',
    severity: 'info',
    title: `'${att.displayName}' can't be activated as an FZCO save-for-target plan in v1`,
    detail:
      `FZCO save-for-target plans require a dedicated AED savings account, which isn't ` +
      `configured in v1. The plan was rejected at attempt time (${att.attemptedAt}). ` +
      `Switch to a UK Ltd or household scope, or wait for v2 (deferred from §1.9).`,
    recommended_action:
      `Either change the plan's scope to 'household' / 'autonize-it-ltd', or hold off ` +
      `until an FZCO AED savings account is configured.`,
    sources: [`plan-attempt:${att.attemptKey}`, 'plan-blocked-fzco-no-savings-account'],
    context: {
      displayName: att.displayName,
      attemptedAt: att.attemptedAt,
    },
  }));
}

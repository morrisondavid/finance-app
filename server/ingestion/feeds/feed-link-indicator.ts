/**
 * Bank-feed connection indicator for account chips (red / green / amber).
 *
 * Reuses {@link deriveFeedToolbarState} for linkage — does not probe live tokens.
 * Amber uses PSD2-aligned consent expiry (see ROADMAP §3.4 re-consent).
 *
 * Limitations: "linked" means configured token/session + account id, not a live
 * refresh probe; revoked tokens stay green until sync fails or consent window ends.
 */

import {
  ACCOUNTS,
  FeedLinkIndicatorSchema,
  type AccountName,
  type FeedLinkIndicator,
  type FeedLinkIndicatorStatus,
} from '../../../shared/api-contracts.js';
import { getAccountConfig } from '../../domain/accounts/index.js';
import { PARSERS } from '../../parsers/index.js';
import { getAccountSession } from './enable-session-store.js';
import {
  deriveFeedToolbarState,
  type DeriveFeedToolbarStateDeps,
} from './feed-toolbar-state.js';
import { requireLinkedFeed } from './sync.js';
import { FEED_CONSENT_MAX_DAYS, resolveTrueLayerConsentExpiresAt } from './truelayer/truelayer-tokens.js';

export { FEED_CONSENT_MAX_DAYS };
export const FEED_CONSENT_WARN_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDaysIso(iso: string, days: number): string {
  const base = Date.parse(iso);
  if (!Number.isFinite(base)) {
    throw new Error(`Invalid ISO timestamp: ${iso}`);
  }
  return new Date(base + days * MS_PER_DAY).toISOString();
}

function resolveEnableConsentExpiresAt(enableAccountId: string): string | undefined {
  const session = getAccountSession(enableAccountId);
  if (session === undefined) return undefined;

  const validUntil = session.validUntil?.trim();
  if (validUntil !== undefined && validUntil !== '') {
    return validUntil;
  }

  const linkedAt = session.linked_at?.trim();
  if (linkedAt !== undefined && linkedAt !== '') {
    return addDaysIso(linkedAt, FEED_CONSENT_MAX_DAYS);
  }

  return undefined;
}

function linkedStatusFromExpiry(
  consentExpiresAt: string | undefined,
  now: Date,
): Pick<FeedLinkIndicator, 'status' | 'consentExpiresAt'> {
  if (consentExpiresAt === undefined) {
    return { status: 'connected', consentExpiresAt: null };
  }

  const expiresMs = Date.parse(consentExpiresAt);
  if (!Number.isFinite(expiresMs)) {
    return { status: 'connected', consentExpiresAt: null };
  }

  const warnStartMs = expiresMs - FEED_CONSENT_WARN_DAYS * MS_PER_DAY;
  const status: FeedLinkIndicatorStatus =
    now.getTime() >= warnStartMs ? 'expiring_soon' : 'connected';

  return { status, consentExpiresAt };
}

export interface DeriveFeedLinkIndicatorDeps extends DeriveFeedToolbarStateDeps {
  readonly now?: () => Date;
  readonly resolveTrueLayerConsentExpiresAtFn?: (account: AccountName) => string | undefined;
  readonly resolveEnableConsentExpiresAtFn?: (enableAccountId: string) => string | undefined;
}

export function deriveFeedLinkIndicator(
  account: AccountName,
  deps: DeriveFeedLinkIndicatorDeps,
): FeedLinkIndicator {
  const now = deps.now?.() ?? new Date();
  const toolbar = deriveFeedToolbarState(account, deps);

  if (toolbar.kind === 'hidden') {
    return FeedLinkIndicatorSchema.parse({ status: 'not_applicable' });
  }

  if (toolbar.kind === 'connect') {
    return FeedLinkIndicatorSchema.parse({ status: 'disconnected' });
  }

  const resolveTl =
    deps.resolveTrueLayerConsentExpiresAtFn ?? resolveTrueLayerConsentExpiresAt;
  const resolveEb =
    deps.resolveEnableConsentExpiresAtFn ?? resolveEnableConsentExpiresAt;

  let consentExpiresAt: string | undefined;
  if (toolbar.activeProvider === 'truelayer') {
    consentExpiresAt = resolveTl(account);
  } else {
    const enableAccountId = deps.getAccountConfig(account).aispFeed?.enableBanking?.accountId?.trim();
    if (enableAccountId !== undefined && enableAccountId !== '') {
      consentExpiresAt = resolveEb(enableAccountId);
    }
  }

  return FeedLinkIndicatorSchema.parse(linkedStatusFromExpiry(consentExpiresAt, now));
}

export function feedLinkIndicatorsForAllAccounts(
  deps: DeriveFeedLinkIndicatorDeps = defaultFeedLinkIndicatorDeps(),
): Record<AccountName, FeedLinkIndicator> {
  const result = {} as Record<AccountName, FeedLinkIndicator>;
  for (const account of ACCOUNTS) {
    result[account] = deriveFeedLinkIndicator(account, deps);
  }
  return result;
}

function defaultFeedLinkIndicatorDeps(): DeriveFeedLinkIndicatorDeps {
  return {
    getAccountConfig,
    parsers: PARSERS,
    requireLinkedFeedFn: requireLinkedFeed,
  };
}

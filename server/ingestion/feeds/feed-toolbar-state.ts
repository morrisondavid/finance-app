/**
 * Derived UI state for the dashboard bank-feed toolbar (Connect vs Sync).
 * Delegates linkage rules to {@link requireLinkedFeed} — no OAuth HTTP calls.
 */

import type { AccountName, FeedToolbarState } from '../../../shared/api-contracts.js';
import type { AccountConfig } from '../../domain/accounts/schema.js';
import type { ParserMap } from '../../types.js';
import { getAccountConfig } from '../../domain/accounts/index.js';
import { PARSERS } from '../../parsers/index.js';
import { FeedSyncError, requireLinkedFeed } from './sync.js';

export interface DeriveFeedToolbarStateDeps {
  readonly getAccountConfig: (account: AccountName) => AccountConfig;
  readonly parsers: ParserMap;
  readonly requireLinkedFeedFn: typeof requireLinkedFeed;
}

function pickConnectProvider(config: AccountConfig): 'truelayer' | 'enable' {
  if (config.aispFeed?.trueLayer !== undefined) {
    return 'truelayer';
  }
  if (config.aispFeed?.enableBanking !== undefined) {
    return 'enable';
  }
  return 'enable';
}

function hasConfiguredTrueLayerDataAccountId(config: AccountConfig): boolean {
  const id = config.aispFeed?.trueLayer?.dataAccountId?.trim() ?? '';
  return id !== '';
}

/** Public for tests via dependency injection only. */
export function deriveFeedToolbarState(
  account: AccountName,
  deps: DeriveFeedToolbarStateDeps,
): FeedToolbarState {
  let config: AccountConfig;
  try {
    config = deps.getAccountConfig(account);
  } catch {
    return { kind: 'hidden', account, reason: 'no-aisp-feed' };
  }

  const parser = deps.parsers[account];
  if (parser === undefined || parser.emitFeedTransactionsAsCsv === undefined) {
    return { kind: 'hidden', account, reason: 'no-feed-emitter' };
  }

  if (config.aispFeed === undefined) {
    return { kind: 'hidden', account, reason: 'no-aisp-feed' };
  }

  const canOfferConnect =
    config.aispFeed.trueLayer !== undefined || config.aispFeed.enableBanking !== undefined;
  if (!canOfferConnect) {
    return { kind: 'hidden', account, reason: 'no-aisp-feed' };
  }

  try {
    const linked = deps.requireLinkedFeedFn(account);
    return {
      kind: 'sync',
      account,
      activeProvider: linked.provider,
    };
  } catch (e) {
    if (e instanceof FeedSyncError) {
      if (e.code === 'not-linked') {
        const connectProvider = pickConnectProvider(config);
        const reconnect =
          connectProvider === 'truelayer' && hasConfiguredTrueLayerDataAccountId(config);
        return {
          kind: 'connect',
          account,
          connectProvider,
          ...(reconnect ? { reconnect: true } : {}),
        };
      }
      if (e.code === 'unknown-account') {
        return { kind: 'hidden', account, reason: 'no-aisp-feed' };
      }
      if (e.code === 'no-emitter') {
        return { kind: 'hidden', account, reason: 'no-feed-emitter' };
      }
    }
    throw e;
  }
}

/**
 * Resolved feed toolbar payload for dashboard — default production deps.
 */
export function feedToolbarStateForAccount(account: AccountName): FeedToolbarState {
  return deriveFeedToolbarState(account, {
    getAccountConfig,
    parsers: PARSERS,
    requireLinkedFeedFn: requireLinkedFeed,
  });
}

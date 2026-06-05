/**
 * Accounts eligible for scheduled `feed:sync-all` — reuses toolbar linkage rules.
 */

import { ACCOUNTS, type AccountName } from '../../../shared/api-contracts.js';
import { getAccountConfig } from '../../domain/accounts/index.js';
import { PARSERS } from '../../parsers/index.js';
import { deriveFeedToolbarState } from './feed-toolbar-state.js';
import { requireLinkedFeed } from './sync.js';

export type FeedSyncCandidateAction = 'sync' | 'skip';

export interface FeedSyncCandidate {
  readonly account: AccountName;
  readonly action: FeedSyncCandidateAction;
}

const defaultDeps = {
  getAccountConfig,
  parsers: PARSERS,
  requireLinkedFeedFn: requireLinkedFeed,
} as const;

/**
 * Walk all configured accounts. Linked feed-capable accounts sync; others skip
 * silently (hidden / connect / no emitter).
 */
export function listFeedSyncCandidates(
  deps: typeof defaultDeps = defaultDeps,
): FeedSyncCandidate[] {
  return ACCOUNTS.map(account => {
    const toolbar = deriveFeedToolbarState(account, deps);
    if (toolbar.kind === 'sync') {
      return { account, action: 'sync' as const };
    }
    return { account, action: 'skip' as const };
  });
}

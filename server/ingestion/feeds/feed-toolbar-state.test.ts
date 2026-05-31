import { describe, it, expect } from 'vitest';
import type { AccountConfig } from '../../domain/accounts/schema.js';
import type { ParserMap } from '../../types.js';
import { ACCOUNT_CONFIG_DATA } from '../../domain/accounts/data.js';
import { PARSERS } from '../../parsers/index.js';
import {
  deriveFeedToolbarState,
  type DeriveFeedToolbarStateDeps,
} from './feed-toolbar-state.js';
import { FeedSyncError, requireLinkedFeed, type LinkedFeed } from './sync.js';
import { FeedToolbarStateSchema } from '../../../shared/api-contracts.js';

function assertParses(state: ReturnType<typeof deriveFeedToolbarState>): void {
  expect(() => FeedToolbarStateSchema.parse(state)).not.toThrow();
}

function mockDeps(partial: Partial<DeriveFeedToolbarStateDeps>): DeriveFeedToolbarStateDeps {
  return {
    getAccountConfig: partial.getAccountConfig ?? (name => ACCOUNT_CONFIG_DATA[name]),
    parsers: partial.parsers ?? PARSERS,
    requireLinkedFeedFn: partial.requireLinkedFeedFn ?? requireLinkedFeed,
  };
}

describe('deriveFeedToolbarState', () => {
  it('not-linked barclays-shaped config → connect truelayer (TL stub preferred)', () => {
    const state = deriveFeedToolbarState(
      'barclays-current',
      mockDeps({
        requireLinkedFeedFn: () => {
          throw new FeedSyncError('not-linked', 'x');
        },
      }),
    );
    assertParses(state);
    expect(state).toEqual({
      kind: 'connect',
      account: 'barclays-current',
      connectProvider: 'truelayer',
    });
  });

  it('natwest (aispFeed configured, not linked) → connect truelayer', () => {
    const state = deriveFeedToolbarState(
      'natwest',
      mockDeps({
        requireLinkedFeedFn: () => {
          throw new FeedSyncError('not-linked', 'x');
        },
      }),
    );
    assertParses(state);
    expect(state).toEqual({
      kind: 'connect',
      account: 'natwest',
      connectProvider: 'truelayer',
    });
  });

  it('linked → sync with activeProvider from requireLinkedFeed', () => {
    const mockCfg = ACCOUNT_CONFIG_DATA['barclays-current'];
    const linked: LinkedFeed = {
      config: mockCfg,
      parser: PARSERS['barclays-current'],
      feedCurrency: 'GBP',
      provider: 'enable',
      enable: { enableAccountId: 'e1' },
    };
    const state = deriveFeedToolbarState(
      'barclays-current',
      mockDeps({
        requireLinkedFeedFn: () => linked,
      }),
    );
    assertParses(state);
    expect(state).toEqual({
      kind: 'sync',
      account: 'barclays-current',
      activeProvider: 'enable',
    });
  });

  it('not-linked with only Enable stub → connect enable', () => {
    const base = ACCOUNT_CONFIG_DATA['natwest'];
    const mockCfg: AccountConfig = {
      ...base,
      aispFeed: {
        enableBanking: {
          institutionHint: { institutionName: 'NatWest', country: 'GB' },
        },
      },
    };
    const state = deriveFeedToolbarState(
      'natwest',
      mockDeps({
        getAccountConfig: () => mockCfg,
        parsers: PARSERS,
        requireLinkedFeedFn: () => {
          throw new FeedSyncError('not-linked', 'x');
        },
      }),
    );
    assertParses(state);
    expect(state).toEqual({
      kind: 'connect',
      account: 'natwest',
      connectProvider: 'enable',
    });
  });

  it('santander-everyday (TrueLayer configured) → connect truelayer when not linked', () => {
    const state = deriveFeedToolbarState(
      'santander-everyday',
      mockDeps({
        requireLinkedFeedFn: () => {
          throw new FeedSyncError('not-linked', 'x');
        },
      }),
    );
    assertParses(state);
    expect(state).toEqual({
      kind: 'connect',
      account: 'santander-everyday',
      connectProvider: 'truelayer',
    });
  });

  it('not-linked TrueLayer with configured dataAccountId → connect reconnect', () => {
    const base = ACCOUNT_CONFIG_DATA['monzo-joint'];
    const mockCfg: AccountConfig = {
      ...base,
      aispFeed: {
        trueLayer: {
          providerId: 'ob-monzo',
          dataAccountId: 'tl-monzo-joint-id',
        },
      },
    };
    const state = deriveFeedToolbarState(
      'monzo-joint',
      mockDeps({
        getAccountConfig: () => mockCfg,
        requireLinkedFeedFn: () => {
          throw new FeedSyncError('not-linked', 'x');
        },
      }),
    );
    assertParses(state);
    expect(state).toEqual({
      kind: 'connect',
      account: 'monzo-joint',
      connectProvider: 'truelayer',
      reconnect: true,
    });
  });

  it('missing parser for account → hidden no-feed-emitter', () => {
    const minimalParsers = { 'barclays-savings': PARSERS['barclays-savings'] } as unknown as ParserMap;
    const state = deriveFeedToolbarState(
      'barclays-current',
      mockDeps({
        parsers: minimalParsers,
      }),
    );
    assertParses(state);
    expect(state).toEqual({
      kind: 'hidden',
      account: 'barclays-current',
      reason: 'no-feed-emitter',
    });
  });

  it('feedToolbarStateForAccount parses against wire schema', async () => {
    const { feedToolbarStateForAccount } = await import('./feed-toolbar-state.js');
    const state = feedToolbarStateForAccount('barclays-current');
    FeedToolbarStateSchema.parse(state);
  });
});

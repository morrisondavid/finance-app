import { describe, it, expect } from 'vitest';
import type { AccountConfig } from '../../domain/accounts/schema.js';
import { ACCOUNT_CONFIG_DATA } from '../../domain/accounts/data.js';
import { PARSERS } from '../../parsers/index.js';
import { FeedLinkIndicatorSchema } from '../../../shared/api-contracts.js';
import { FeedSyncError, requireLinkedFeed, type LinkedFeed } from './sync.js';
import {
  deriveFeedLinkIndicator,
  FEED_CONSENT_WARN_DAYS,
  feedLinkIndicatorsForAllAccounts,
  type DeriveFeedLinkIndicatorDeps,
} from './feed-link-indicator.js';

function assertParses(indicator: ReturnType<typeof deriveFeedLinkIndicator>): void {
  expect(() => FeedLinkIndicatorSchema.parse(indicator)).not.toThrow();
}

function mockDeps(partial: Partial<DeriveFeedLinkIndicatorDeps>): DeriveFeedLinkIndicatorDeps {
  return {
    getAccountConfig: partial.getAccountConfig ?? (name => ACCOUNT_CONFIG_DATA[name]),
    parsers: partial.parsers ?? PARSERS,
    requireLinkedFeedFn: partial.requireLinkedFeedFn ?? requireLinkedFeed,
    now: partial.now,
    resolveTrueLayerConsentExpiresAtFn: partial.resolveTrueLayerConsentExpiresAtFn,
    resolveEnableConsentExpiresAtFn: partial.resolveEnableConsentExpiresAtFn,
  };
}

function linkedTrueLayerDeps(expiresAt: string): Partial<DeriveFeedLinkIndicatorDeps> {
  const mockCfg = ACCOUNT_CONFIG_DATA['wise-ltd'];
  const linked: LinkedFeed = {
    config: mockCfg,
    parser: PARSERS['wise-ltd'],
    feedCurrency: 'GBP',
    provider: 'truelayer',
    trueLayer: { dataAccountId: 'tl-wise-1' },
  };
  return {
    requireLinkedFeedFn: () => linked,
    resolveTrueLayerConsentExpiresAtFn: () => expiresAt,
    now: () => new Date('2026-05-01T12:00:00.000Z'),
  };
}

describe('deriveFeedLinkIndicator', () => {
  it('CSV-only capital-on-tap → not_applicable', () => {
    const indicator = deriveFeedLinkIndicator('capital-on-tap', mockDeps({}));
    assertParses(indicator);
    expect(indicator).toEqual({ status: 'not_applicable' });
  });

  it('emirates-islamic (no aispFeed) → not_applicable', () => {
    const indicator = deriveFeedLinkIndicator('emirates-islamic', mockDeps({}));
    assertParses(indicator);
    expect(indicator).toEqual({ status: 'not_applicable' });
  });

  it('not-linked TrueLayer account → disconnected', () => {
    const indicator = deriveFeedLinkIndicator(
      'wise-ltd',
      mockDeps({
        requireLinkedFeedFn: () => {
          throw new FeedSyncError('not-linked', 'x');
        },
      }),
    );
    assertParses(indicator);
    expect(indicator).toEqual({ status: 'disconnected' });
  });

  it('linked with expiry 20 days out → connected', () => {
    const expiresAt = '2026-05-21T12:00:00.000Z';
    const indicator = deriveFeedLinkIndicator('wise-ltd', mockDeps(linkedTrueLayerDeps(expiresAt)));
    assertParses(indicator);
    expect(indicator).toEqual({ status: 'connected', consentExpiresAt: expiresAt });
  });

  it('linked with expiry within warn window → expiring_soon', () => {
    const expiresAt = '2026-05-06T12:00:00.000Z';
    const indicator = deriveFeedLinkIndicator('wise-ltd', mockDeps(linkedTrueLayerDeps(expiresAt)));
    assertParses(indicator);
    expect(indicator).toEqual({ status: 'expiring_soon', consentExpiresAt: expiresAt });
  });

  it('linked Enable provider uses enable consent resolver', () => {
    const mockCfg = ACCOUNT_CONFIG_DATA['barclays-current'];
    const cfgWithEnableId: AccountConfig = {
      ...mockCfg,
      aispFeed: {
        ...mockCfg.aispFeed,
        enableBanking: {
          ...mockCfg.aispFeed?.enableBanking,
          institutionHint: { institutionName: 'Barclays', country: 'GB' },
          accountId: 'eb-1',
        },
      },
    };
    const linked: LinkedFeed = {
      config: mockCfg,
      parser: PARSERS['barclays-current'],
      feedCurrency: 'GBP',
      provider: 'enable',
      enable: { enableAccountId: 'eb-1' },
    };
    const expiresAt = '2026-06-01T00:00:00.000Z';
    const indicator = deriveFeedLinkIndicator(
      'barclays-current',
      mockDeps({
        getAccountConfig: () => cfgWithEnableId,
        requireLinkedFeedFn: () => linked,
        resolveEnableConsentExpiresAtFn: id => (id === 'eb-1' ? expiresAt : undefined),
        now: () => new Date('2026-05-01T12:00:00.000Z'),
      }),
    );
    assertParses(indicator);
    expect(indicator).toEqual({ status: 'connected', consentExpiresAt: expiresAt });
  });

  it('TrueLayer row with only updated_at infers expiry via resolver', () => {
    const updatedAt = '2026-01-01T00:00:00.000Z';
    const inferredExpiry = '2026-04-01T00:00:00.000Z';
    const indicator = deriveFeedLinkIndicator(
      'wise-ltd',
      mockDeps({
        ...linkedTrueLayerDeps(inferredExpiry),
        resolveTrueLayerConsentExpiresAtFn: () => {
          const base = Date.parse(updatedAt);
          return new Date(base + 90 * 24 * 60 * 60 * 1000).toISOString();
        },
        now: () => new Date('2026-03-20T00:00:00.000Z'),
      }),
    );
    assertParses(indicator);
    expect(indicator.status).toBe('expiring_soon');
    expect(indicator.consentExpiresAt).toBe(inferredExpiry);
  });

  it('feedLinkIndicatorsForAllAccounts includes every ledger account', () => {
    const map = feedLinkIndicatorsForAllAccounts(
      mockDeps({
        requireLinkedFeedFn: () => {
          throw new FeedSyncError('not-linked', 'x');
        },
      }),
    );
    expect(Object.keys(map).length).toBeGreaterThan(0);
    for (const value of Object.values(map)) {
      FeedLinkIndicatorSchema.parse(value);
    }
    expect(map['capital-on-tap'].status).toBe('not_applicable');
    expect(map['wise-ltd'].status).toBe('disconnected');
  });
});

describe('FEED_CONSENT_WARN_DAYS', () => {
  it('is 14 days', () => {
    expect(FEED_CONSENT_WARN_DAYS).toBe(14);
  });
});

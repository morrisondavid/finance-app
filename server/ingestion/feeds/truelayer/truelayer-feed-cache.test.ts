import { describe, expect, it, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  isTrueLayerFeedCacheEnabled,
  readTrueLayerFeedCache,
  trueLayerFeedCacheRelPath,
  writeTrueLayerFeedCache,
  TRUELAYER_FEED_CACHE_DIR_REL,
} from './truelayer-feed-cache.js';
import { fetchTrueLayerTransactions } from './truelayer-transactions.js';
import { canonicalTrueLayerRawTransactions } from './truelayer-transaction-fixtures.js';
import { REPO_ROOT } from '../../../repo-root.js';

function cleanupFeedCacheDir(): void {
  const dir = path.join(REPO_ROOT, TRUELAYER_FEED_CACHE_DIR_REL);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('isTrueLayerFeedCacheEnabled', () => {
  const prevMode = process.env.TRUELAYER_FEED_CACHE_MODE;

  afterEach(() => {
    if (prevMode === undefined) delete process.env.TRUELAYER_FEED_CACHE_MODE;
    else process.env.TRUELAYER_FEED_CACHE_MODE = prevMode;
  });

  it('defaults to enabled', () => {
    delete process.env.TRUELAYER_FEED_CACHE_MODE;
    expect(isTrueLayerFeedCacheEnabled()).toBe(true);
  });

  it('honours off', () => {
    expect(isTrueLayerFeedCacheEnabled('off')).toBe(false);
  });
});

describe('trueLayer feed cache disk round-trip', () => {
  afterEach(() => {
    cleanupFeedCacheDir();
  });

  it('writes and reads envelope from disk', async () => {
    await writeTrueLayerFeedCache({
      account: 'monzo-joint',
      trueLayerAccountId: 'acc-1',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      results: canonicalTrueLayerRawTransactions,
    });

    const rel = trueLayerFeedCacheRelPath('monzo-joint', 'acc-1', '2026-01-01', '2026-01-31');
    const hit = await readTrueLayerFeedCache({
      account: 'monzo-joint',
      trueLayerAccountId: 'acc-1',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    });
    expect(hit).not.toBeNull();
    expect(hit?.results.length).toBe(canonicalTrueLayerRawTransactions.length);
    expect(fs.existsSync(path.join(REPO_ROOT, rel))).toBe(true);
  });
});

describe('fetchTrueLayerTransactions cache hit', () => {
  afterEach(() => {
    cleanupFeedCacheDir();
  });

  it('uses cache without calling fetch', async () => {
    const mapRow = (raw: { transaction_id: string }) => ({
      date: '2026-01-15',
      description: raw.transaction_id,
      amount: 1,
      currency: 'GBP',
    });

    await writeTrueLayerFeedCache({
      account: 'monzo-joint',
      trueLayerAccountId: 'acc-1',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      results: canonicalTrueLayerRawTransactions,
    });

    let fetchCalled = false;
    const result = await fetchTrueLayerTransactions(
      {
        account: 'monzo-joint',
        trueLayerAccountId: 'acc-1',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        currency: 'GBP',
      },
      {
        mapTrueLayerTransaction: mapRow,
        fetch: () => {
          fetchCalled = true;
          return Promise.resolve(new Response('{}'));
        },
      },
    );

    expect(fetchCalled).toBe(false);
    expect(result.trueLayerFetchSource).toBe('cache');
    expect(result.rows.length).toBeGreaterThan(0);
  });
});

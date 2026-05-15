import { describe, it, expect } from 'vitest';
import {
  computeFeedSyncDateFromNewestTransaction,
  FEED_SYNC_FALLBACK_DATE_FROM,
} from './feed-sync-window.js';

describe('computeFeedSyncDateFromNewestTransaction', () => {
  it('returns day after newest transaction (ISO prefix)', () => {
    expect(computeFeedSyncDateFromNewestTransaction('2024-06-30T12:00:00.000Z')).toBe('2024-07-01');
  });

  it('uses fallback when null or empty', () => {
    expect(computeFeedSyncDateFromNewestTransaction(null)).toBe(FEED_SYNC_FALLBACK_DATE_FROM);
    expect(computeFeedSyncDateFromNewestTransaction('')).toBe(FEED_SYNC_FALLBACK_DATE_FROM);
  });

  it('uses fallback when date prefix is invalid', () => {
    expect(computeFeedSyncDateFromNewestTransaction('not-a-date')).toBe(FEED_SYNC_FALLBACK_DATE_FROM);
  });
});

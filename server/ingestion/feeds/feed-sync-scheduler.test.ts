import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isFeedSyncScheduleEnabled,
  nextFeedSyncScheduledRunAt,
  stopFeedSyncSchedulerForTests,
} from './feed-sync-scheduler.js';

describe('feed-sync-scheduler', () => {
  afterEach(() => {
    stopFeedSyncSchedulerForTests();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv('FEED_SYNC_SCHEDULE_ENABLED', 'true');
  });

  it('isFeedSyncScheduleEnabled defaults off outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FEED_SYNC_SCHEDULE_ENABLED', '');
    expect(isFeedSyncScheduleEnabled()).toBe(false);
  });

  it('nextFeedSyncScheduledRunAt finds a future slot', () => {
    const from = new Date('2026-06-03T15:30:00.000Z');
    const next = nextFeedSyncScheduledRunAt(from);
    expect(next).not.toBeNull();
    expect(next?.getTime()).toBeGreaterThan(from.getTime());
  });
});

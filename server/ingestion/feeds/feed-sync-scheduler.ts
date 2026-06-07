/**
 * In-process feed sync scheduler (replaces host crontab).
 * Fires at 16:00 and 23:00 Europe/London daily.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { runFeedSyncAllGuarded } from './feed-sync-guard.js';

const CRON_EXPRESSION = '0 16,23 * * *';
const TIMEZONE = 'Europe/London';

let scheduledTask: ScheduledTask | null = null;

export function isFeedSyncScheduleEnabled(
  raw: string | undefined = process.env.FEED_SYNC_SCHEDULE_ENABLED,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): boolean {
  if (raw === undefined || raw.trim() === '') {
    return isProduction;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return true;
}

interface LondonWallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function getLondonWallClock(date: Date): LondonWallClock {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find(part => part.type === type)?.value ?? '0';
    return Number.parseInt(value, 10);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

function matchesFeedSyncCron(date: Date): boolean {
  const wall = getLondonWallClock(date);
  return wall.minute === 0 && (wall.hour === 16 || wall.hour === 23);
}

/** Next 16:00 or 23:00 Europe/London strictly after `from`. */
export function nextFeedSyncScheduledRunAt(from: Date = new Date()): Date | null {
  if (!isFeedSyncScheduleEnabled()) {
    return null;
  }

  let cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor = new Date(cursor.getTime() + 60_000);

  for (let i = 0; i < 48 * 60; i += 1) {
    if (matchesFeedSyncCron(cursor)) {
      return cursor;
    }
    cursor = new Date(cursor.getTime() + 60_000);
  }

  return null;
}

export function nextScheduledRunIso(from: Date = new Date()): string | null {
  const next = nextFeedSyncScheduledRunAt(from);
  return next === null ? null : next.toISOString();
}

export function startFeedSyncScheduler(): void {
  if (!isFeedSyncScheduleEnabled()) {
    console.log('[FeedSyncScheduler] Disabled (FEED_SYNC_SCHEDULE_ENABLED=false or non-production default)');
    return;
  }

  if (scheduledTask !== null) {
    return;
  }

  scheduledTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runFeedSyncAllGuarded({ trigger: 'scheduled' }).catch(err => {
        console.error('[FeedSyncScheduler] Scheduled sync failed:', err);
      });
    },
    { timezone: TIMEZONE },
  );

  const next = nextScheduledRunIso();
  console.log(
    `[FeedSyncScheduler] Active (${CRON_EXPRESSION} ${TIMEZONE})` +
      (next !== null ? ` — next run ${next}` : ''),
  );
}

export function stopFeedSyncSchedulerForTests(): void {
  if (scheduledTask !== null) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}

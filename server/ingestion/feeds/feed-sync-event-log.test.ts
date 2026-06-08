import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TrueLayerError } from './truelayer/truelayer-error.js';
import {
  appendFeedSyncEvent,
  FEED_SYNC_EVENT_LOG_MAX_LINES,
  formatFeedSyncError,
  readFeedSyncEventsForRun,
} from './feed-sync-event-log.js';

describe('formatFeedSyncError', () => {
  it('extracts message, stack, and code from Error subclasses', () => {
    const err = new TrueLayerError('http-error', 'TrueLayer upstream failed', new Error('socket reset'));
    const formatted = formatFeedSyncError(err);
    expect(formatted.message).toBe('TrueLayer upstream failed');
    expect(formatted.code).toBe('http-error');
    expect(formatted.stack).toContain('TrueLayerError');
    expect(formatted.cause).toBe('socket reset');
  });

  it('returns Unknown error for non-Error values', () => {
    expect(formatFeedSyncError('nope')).toEqual({ message: 'Unknown error' });
  });
});

describe('feed-sync-event-log', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-sync-event-log-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('appends and reads events for a run id', () => {
    appendFeedSyncEvent(
      {
        runId: 'run-a',
        trigger: 'manual',
        level: 'info',
        kind: 'run_start',
        message: 'started',
      },
      tmpRoot,
    );
    appendFeedSyncEvent(
      {
        runId: 'run-a',
        trigger: 'manual',
        level: 'info',
        kind: 'fetch_ok',
        message: 'fetched rows',
        account: 'barclays-current',
        detail: { rowsFetched: 2 },
      },
      tmpRoot,
    );
    appendFeedSyncEvent(
      {
        runId: 'run-b',
        trigger: 'scheduled',
        level: 'info',
        kind: 'run_start',
        message: 'other run',
      },
      tmpRoot,
    );

    const events = readFeedSyncEventsForRun('run-a', tmpRoot);
    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe('run_start');
    expect(events[1]?.kind).toBe('fetch_ok');
    expect(events[1]?.detail).toEqual({ rowsFetched: 2 });
  });

  it('trims file to max lines on append', () => {
    for (let i = 0; i < FEED_SYNC_EVENT_LOG_MAX_LINES + 10; i += 1) {
      appendFeedSyncEvent(
        {
          runId: 'run-trim',
          trigger: 'scheduled',
          level: 'info',
          kind: 'window',
          message: `event-${String(i)}`,
        },
        tmpRoot,
      );
    }

    const filePath = path.join(tmpRoot, 'data', 'feed-sync-events.jsonl');
    const lineCount = fs.readFileSync(filePath, 'utf-8').split('\n').filter(line => line.trim() !== '').length;
    expect(lineCount).toBe(FEED_SYNC_EVENT_LOG_MAX_LINES);
  });
});

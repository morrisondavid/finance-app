/**
 * Smoke tests for the §3.4 `POST /api/feed/sync` route.
 *
 * The single-account guard (`runFeedSyncSingleGuarded`) is mocked so the
 * route's HTTP translation (Zod parse → status code + body shape) is
 * exercised in isolation. The guard's behaviour is covered by its own
 * unit tests; the orchestrator's behaviour is covered by
 * `server/ingestion/feeds/sync.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type { FeedSyncSingleDetachedResponse } from '../../shared/api-contracts.js';

const { runFeedSyncSingleGuardedMock, runFeedSyncAllGuardedMock, buildFeedSyncRunsResponseMock, readFeedSyncRunLogMock, readFeedSyncEventsForRunMock } = vi.hoisted(() => ({
  runFeedSyncSingleGuardedMock: vi.fn(),
  runFeedSyncAllGuardedMock: vi.fn(),
  buildFeedSyncRunsResponseMock: vi.fn(),
  readFeedSyncRunLogMock: vi.fn(),
  readFeedSyncEventsForRunMock: vi.fn(),
}));

vi.mock('../ingestion/feeds/feed-sync-single-guard.js', () => ({
  runFeedSyncSingleGuarded: runFeedSyncSingleGuardedMock,
}));

vi.mock('../ingestion/feeds/feed-sync-guard.js', () => ({
  runFeedSyncAllGuarded: runFeedSyncAllGuardedMock,
}));

vi.mock('../ingestion/feeds/feed-sync-runs-response.js', () => ({
  buildFeedSyncRunsResponse: buildFeedSyncRunsResponseMock,
}));

vi.mock('../ingestion/feeds/feed-sync-run-log.js', () => ({
  readFeedSyncRunLog: readFeedSyncRunLogMock,
}));

vi.mock('../ingestion/feeds/feed-sync-event-log.js', () => ({
  readFeedSyncEventsForRun: readFeedSyncEventsForRunMock,
}));

const { default: feedRouter } = await import('./feed.js');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/feed', feedRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port.toString()}`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  }
});

beforeEach(() => {
  runFeedSyncSingleGuardedMock.mockReset();
  runFeedSyncAllGuardedMock.mockReset();
  buildFeedSyncRunsResponseMock.mockReset();
  readFeedSyncRunLogMock.mockReset();
  readFeedSyncEventsForRunMock.mockReset();
});

const SYNC_BODY = { account: 'barclays-current', dateFrom: '2026-04-15', dateTo: '2026-04-20', force: true };

describe('POST /api/feed/sync — validation', () => {
  it('400 when dateFrom is missing', async () => {
    const res = await fetch(`${baseUrl}/api/feed/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'barclays-current' }),
    });
    expect(res.status).toBe(400);
    expect(runFeedSyncSingleGuardedMock).not.toHaveBeenCalled();
  });

  it('400 when account is missing', async () => {
    const res = await fetch(`${baseUrl}/api/feed/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dateFrom: '2026-04-15' }),
    });
    expect(res.status).toBe(400);
    expect(runFeedSyncSingleGuardedMock).not.toHaveBeenCalled();
  });

  it('400 when dateFrom is not ISO yyyy-MM-dd', async () => {
    const res = await fetch(`${baseUrl}/api/feed/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'barclays-current', dateFrom: '2026/04/15' }),
    });
    expect(res.status).toBe(400);
  });

  it('400 when account is not in AccountNameSchema', async () => {
    const res = await fetch(`${baseUrl}/api/feed/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'not-a-real-bank', dateFrom: '2026-04-15' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/feed/sync — detached response', () => {
  it('202 when started (detached)', async () => {
    runFeedSyncSingleGuardedMock.mockResolvedValue({
      state: 'started',
      runId: 'run-1',
      startedAt: '2026-06-03T16:00:00.000Z',
    });

    const res = await fetch(`${baseUrl}/api/feed/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SYNC_BODY),
    });
    expect(res.status).toBe(202);
    const body = await res.json() as FeedSyncSingleDetachedResponse;
    expect(body.state).toBe('started');

    expect(runFeedSyncSingleGuardedMock).toHaveBeenCalledOnce();
    expect(runFeedSyncSingleGuardedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'barclays-current',
        dateFrom: '2026-04-15',
        dateTo: '2026-04-20',
        force: true,
        detached: true,
      }),
    );
  });

  it('409 when in-progress', async () => {
    runFeedSyncSingleGuardedMock.mockResolvedValue({
      state: 'in-progress',
      startedAt: '2026-06-03T16:00:00.000Z',
    });

    const res = await fetch(`${baseUrl}/api/feed/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'barclays-current', dateFrom: '2026-04-15' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as FeedSyncSingleDetachedResponse;
    expect(body.state).toBe('in-progress');
  });

  it('200 when deduped (cooldown)', async () => {
    runFeedSyncSingleGuardedMock.mockResolvedValue({
      state: 'deduped',
      run: {
        id: 'run-1',
        startedAt: '2026-06-03T16:00:00.000Z',
        finishedAt: '2026-06-03T16:00:05.000Z',
        trigger: 'manual',
        lookbackDays: 1,
        outcome: 'ok',
        durationMs: 5000,
        accounts: [],
      },
    });

    const res = await fetch(`${baseUrl}/api/feed/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'barclays-current', dateFrom: '2026-04-15' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as FeedSyncSingleDetachedResponse;
    expect(body.state).toBe('deduped');
  });
});

describe('GET /api/feed/sync-runs', () => {
  it('200 + returns run history payload', async () => {
    buildFeedSyncRunsResponseMock.mockReturnValue({
      runs: [],
      lastRunAt: null,
      overdue: true,
      nextScheduledRunAt: '2026-06-03T23:00:00.000Z',
    });

    const res = await fetch(`${baseUrl}/api/feed/sync-runs`);
    expect(res.status).toBe(200);
    const body = await res.json() as { overdue: boolean };
    expect(body.overdue).toBe(true);
    expect(buildFeedSyncRunsResponseMock).toHaveBeenCalledOnce();
  });
});

describe('GET /api/feed/sync-runs/:runId/events', () => {
  it('404 when run id is unknown', async () => {
    readFeedSyncRunLogMock.mockReturnValue({ runs: [] });

    const res = await fetch(`${baseUrl}/api/feed/sync-runs/missing-run/events`);
    expect(res.status).toBe(404);
    expect(readFeedSyncEventsForRunMock).not.toHaveBeenCalled();
  });

  it('200 + returns events for a known run', async () => {
    readFeedSyncRunLogMock.mockReturnValue({
      runs: [
        {
          id: 'run-1',
          startedAt: '2026-06-03T16:00:00.000Z',
          finishedAt: '2026-06-03T16:00:05.000Z',
          trigger: 'manual',
          lookbackDays: 3,
          outcome: 'ok',
          durationMs: 5000,
          accounts: [],
        },
      ],
    });
    readFeedSyncEventsForRunMock.mockReturnValue([
      {
        at: '2026-06-03T16:00:00.000Z',
        runId: 'run-1',
        trigger: 'manual',
        level: 'info',
        kind: 'run_start',
        message: 'started',
      },
    ]);

    const res = await fetch(`${baseUrl}/api/feed/sync-runs/run-1/events`);
    expect(res.status).toBe(200);
    const body = await res.json() as { events: { kind: string }[] };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]?.kind).toBe('run_start');
    expect(readFeedSyncEventsForRunMock).toHaveBeenCalledWith('run-1');
  });
});

describe('POST /api/feed/sync-all', () => {
  it('202 when started (detached manual trigger)', async () => {
    runFeedSyncAllGuardedMock.mockResolvedValue({
      state: 'started',
      runId: 'run-1',
      startedAt: '2026-06-03T16:00:00.000Z',
    });

    const res = await fetch(`${baseUrl}/api/feed/sync-all`, { method: 'POST' });
    expect(res.status).toBe(202);
    const body = await res.json() as { state: string; runId: string };
    expect(body.state).toBe('started');
    expect(body.runId).toBe('run-1');
    expect(runFeedSyncAllGuardedMock).toHaveBeenCalledWith({
      trigger: 'manual',
      detached: true,
    });
  });

  it('200 when deduped', async () => {
    runFeedSyncAllGuardedMock.mockResolvedValue({
      state: 'deduped',
      run: {
        id: 'run-1',
        startedAt: '2026-06-03T16:00:00.000Z',
        finishedAt: '2026-06-03T16:00:05.000Z',
        trigger: 'manual',
        lookbackDays: 3,
        outcome: 'ok',
        durationMs: 5000,
        accounts: [],
      },
    });

    const res = await fetch(`${baseUrl}/api/feed/sync-all`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { state: string };
    expect(body.state).toBe('deduped');
  });

  it('409 when in-progress', async () => {
    runFeedSyncAllGuardedMock.mockResolvedValue({
      state: 'in-progress',
      startedAt: '2026-06-03T16:00:00.000Z',
    });

    const res = await fetch(`${baseUrl}/api/feed/sync-all`, { method: 'POST' });
    expect(res.status).toBe(409);
    const body = await res.json() as { state: string };
    expect(body.state).toBe('in-progress');
  });
});

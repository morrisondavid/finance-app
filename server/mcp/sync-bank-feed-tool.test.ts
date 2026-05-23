/**
 * Behavioural tests for the §3.4 `sync_bank_feed` MCP tool handler.
 *
 * The MCP tool and `POST /api/feed/sync` share the same `runFeedSync`
 * engine; here we mock that engine so the test isolates the MCP-layer
 * concerns: input Zod parsing happens in the SDK, but our handler is
 * still responsible for forwarding args, parsing the result against
 * the shared response schema, and shaping the error envelope (with
 * `isError: true` + structured JSON body) on failure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  FeedSyncBody,
  FeedSyncResponse,
} from '../../shared/api-contracts.js';

const { runFeedSyncMock } = vi.hoisted(() => ({
  runFeedSyncMock: vi.fn(),
}));

vi.mock('../ingestion/feeds/sync.js', async () => {
  const actual = await vi.importActual<typeof import('../ingestion/feeds/sync.js')>(
    '../ingestion/feeds/sync.js',
  );
  return {
    ...actual,
    runFeedSync: runFeedSyncMock,
  };
});

const { runSyncBankFeedMcpTool } = await import('./bank-mcp-server.js');
const { FeedSyncError } = await vi.importActual<typeof import('../ingestion/feeds/sync.js')>(
  '../ingestion/feeds/sync.js',
);
const { EnableBankingError } = await vi.importActual<typeof import('../ingestion/feeds/enable-banking.js')>(
  '../ingestion/feeds/enable-banking.js',
);
const { TrueLayerError } = await vi.importActual<
  typeof import('../ingestion/feeds/truelayer/truelayer-error.js')
>('../ingestion/feeds/truelayer/truelayer-error.js');

const SUCCESS_BODY: FeedSyncResponse = {
  account: 'barclays-current',
  skipped: false,
  window: { dateFrom: '2026-04-15', dateTo: '2026-04-20' },
  rowsFetched: 2,
  csvWritten: true,
  ingestOutcome: 'ingested',
  partitionedFiles: ['2026-04_transactions_barclays-current.csv'],
  initDatabaseRan: true,
};

const VALID_INPUT: FeedSyncBody = {
  account: 'barclays-current',
  dateFrom: '2026-04-15',
  dateTo: '2026-04-20',
  force: true,
};

beforeEach(() => {
  runFeedSyncMock.mockReset();
});

describe('runSyncBankFeedMcpTool — happy path', () => {
  it('forwards args to runFeedSync and returns structuredContent matching the response schema', async () => {
    runFeedSyncMock.mockResolvedValue(SUCCESS_BODY);

    const result = await runSyncBankFeedMcpTool(VALID_INPUT);

    expect(runFeedSyncMock).toHaveBeenCalledOnce();
    expect(runFeedSyncMock).toHaveBeenCalledWith('barclays-current', {
      dateFrom: '2026-04-15',
      dateTo: '2026-04-20',
      force: true,
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(SUCCESS_BODY);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual(SUCCESS_BODY);
  });
});

describe('runSyncBankFeedMcpTool — error envelope', () => {
  it('wraps FeedSyncError in isError + JSON body with code', async () => {
    runFeedSyncMock.mockRejectedValue(new FeedSyncError('not-linked', 'no link'));

    const result = await runSyncBankFeedMcpTool(VALID_INPUT);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const body = JSON.parse(result.content[0].text) as { code: string; message: string };
    expect(body.code).toBe('not-linked');
    expect(body.message).toBe('no link');
  });

  it('wraps EnableBankingError with its specific code', async () => {
    runFeedSyncMock.mockRejectedValue(new EnableBankingError('expired-session', 'session expired'));

    const result = await runSyncBankFeedMcpTool(VALID_INPUT);

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text) as { code: string };
    expect(body.code).toBe('expired-session');
  });

  it('wraps TrueLayerError with its specific code', async () => {
    runFeedSyncMock.mockRejectedValue(new TrueLayerError('expired-session', 're-link'));

    const result = await runSyncBankFeedMcpTool(VALID_INPUT);

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text) as { code: string };
    expect(body.code).toBe('expired-session');
  });

  it('falls through to internal-error for generic exceptions', async () => {
    runFeedSyncMock.mockRejectedValue(new Error('boom'));

    const result = await runSyncBankFeedMcpTool(VALID_INPUT);

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text) as { code: string; message: string };
    expect(body.code).toBe('internal-error');
    expect(body.message).toBe('boom');
  });
});

/**
 * Adapter-level tests for TrueLayer account and card transaction endpoints.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchTrueLayerTransactions } from './truelayer-transactions.js';
import { TrueLayerError } from './truelayer-error.js';
import type { FetchLike } from './truelayer-auth-http.js';
import {
  TRUE_LAYER_ACCOUNT_ID,
  TRUE_LAYER_CARD_ID,
  DATE_FROM,
  DATE_TO,
  canonicalTrueLayerRawTransactions,
  canonicalTrueLayerCardRawTransactions,
  canonicalTrueLayerDebitPurchase,
  canonicalTrueLayerCreditInflow,
  trueLayerOutsideWindow,
  trueLayerSameMerchantAndDescription,
  expectedMappedFeedTransactionRows,
  makeTrueLayerTransactionsEnvelope,
} from './truelayer-transaction-fixtures.js';

const API_BASE = 'https://api.test';
const AUTH_BASE = 'https://auth.test';

interface RecordedCall {
  readonly url: URL;
  readonly init?: RequestInit;
}

interface FakeResponse {
  readonly ok?: boolean;
  readonly status?: number;
  readonly statusText?: string;
  readonly body: unknown;
}

function makeFetch(responses: readonly FakeResponse[]): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    const url = input instanceof URL ? input : new URL(input.toString());
    calls.push({ url, init });
    const r = responses[i++];
    if (r === undefined) {
      throw new Error(`Fake fetch ran out of responses at call ${i.toString()}`);
    }
    const status = r.status ?? 200;
    return {
      ok: r.ok ?? (status >= 200 && status < 300),
      status,
      statusText: r.statusText ?? 'OK',
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
      json: async () => r.body,
    } as globalThis.Response;
  };
  return { fetch: fetchImpl, calls };
}

const tokenRefreshBody = {
  access_token: 'access-token-test',
  refresh_token: 'refresh-token-rotated',
  token_type: 'Bearer',
};

const baseRequest = {
  account: 'barclays-current' as const,
  trueLayerAccountId: TRUE_LAYER_ACCOUNT_ID,
  dateFrom: DATE_FROM,
  dateTo: DATE_TO,
  currency: 'GBP',
};

function trueLayerDeps(fetch: FetchLike, overrides: {
  persistRefreshToken?: (account: typeof baseRequest.account, refreshToken: string) => void;
  getRefreshTokenSource?: () => { refreshToken: string; tokenAccount: typeof baseRequest.account };
} = {}) {
  return {
    fetch,
    apiBase: API_BASE,
    authBase: AUTH_BASE,
    getRefreshTokenSource: overrides.getRefreshTokenSource ?? (() => ({
      refreshToken: 'refresh-token-original',
      tokenAccount: baseRequest.account,
    })),
    persistRefreshToken: overrides.persistRefreshToken ?? vi.fn(),
  };
}

function tokenThenTransactionsFetch(
  transactionPages: readonly ReturnType<typeof makeTrueLayerTransactionsEnvelope>[],
): { fetch: FetchLike; calls: RecordedCall[] } {
  const responses: FakeResponse[] = [
    { body: tokenRefreshBody },
    ...transactionPages.map(body => ({ body })),
  ];
  return makeFetch(responses);
}

beforeEach(() => {
  process.env.TRUELAYER_CLIENT_ID = 'test-client-id';
  process.env.TRUELAYER_CLIENT_SECRET = 'test-client-secret';
});

describe('fetchTrueLayerTransactions — happy paths', () => {
  it('returns mapped rows for a single-page response', async () => {
    const { fetch, calls } = tokenThenTransactionsFetch([
      makeTrueLayerTransactionsEnvelope(canonicalTrueLayerRawTransactions),
    ]);

    const result = await fetchTrueLayerTransactions(baseRequest, trueLayerDeps(fetch));

    expect(result.account).toBe('barclays-current');
    expect(result.window).toEqual({ dateFrom: DATE_FROM, dateTo: DATE_TO });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject(expectedMappedFeedTransactionRows[0]);
    expect(result.rows[1]).toMatchObject(expectedMappedFeedTransactionRows[1]);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url.pathname).toBe('/connect/token');
    const txUrl = calls[1]?.url;
    expect(txUrl?.pathname).toBe(
      `/data/v1/accounts/${TRUE_LAYER_ACCOUNT_ID}/transactions`,
    );
    expect(txUrl?.searchParams.get('from')).toBe(DATE_FROM);
    expect(txUrl?.searchParams.get('to')).toBe(DATE_TO);
    expect(calls[1]?.init?.headers).toMatchObject({
      Authorization: 'Bearer access-token-test',
      Accept: 'application/json',
    });
  });

  it('persists refresh token when TrueLayer rotates it', async () => {
    const persistRefreshToken = vi.fn();
    const { fetch } = tokenThenTransactionsFetch([
      makeTrueLayerTransactionsEnvelope([canonicalTrueLayerDebitPurchase]),
    ]);

    await fetchTrueLayerTransactions(baseRequest, trueLayerDeps(fetch, { persistRefreshToken }));

    expect(persistRefreshToken).toHaveBeenCalledOnce();
    expect(persistRefreshToken).toHaveBeenCalledWith(
      'barclays-current',
      'refresh-token-rotated',
    );
  });

  it('walks next_uri across multiple pages and concatenates rows', async () => {
    const { fetch, calls } = tokenThenTransactionsFetch([
      makeTrueLayerTransactionsEnvelope(
        [canonicalTrueLayerDebitPurchase],
        { next_uri: `${API_BASE}/data/v1/accounts/${TRUE_LAYER_ACCOUNT_ID}/transactions?page=2` },
      ),
      makeTrueLayerTransactionsEnvelope([canonicalTrueLayerCreditInflow]),
    ]);

    const result = await fetchTrueLayerTransactions(baseRequest, trueLayerDeps(fetch));

    expect(result.rows.map(r => r.description)).toEqual([
      expectedMappedFeedTransactionRows[0].description,
      expectedMappedFeedTransactionRows[1].description,
    ]);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.url.searchParams.has('page')).toBe(true);
  });

  it('drops rows outside the requested date window', async () => {
    const { fetch } = tokenThenTransactionsFetch([
      makeTrueLayerTransactionsEnvelope([
        canonicalTrueLayerDebitPurchase,
        trueLayerOutsideWindow,
      ]),
    ]);

    const result = await fetchTrueLayerTransactions(baseRequest, trueLayerDeps(fetch));

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.externalId).toBe('ext-1');
  });

  it('does not duplicate merchant in description when merchant equals description', async () => {
    const { fetch } = tokenThenTransactionsFetch([
      makeTrueLayerTransactionsEnvelope([trueLayerSameMerchantAndDescription]),
    ]);

    const result = await fetchTrueLayerTransactions(
      { ...baseRequest, dateFrom: '2026-04-15', dateTo: '2026-04-15' },
      trueLayerDeps(fetch),
    );

    expect(result.rows[0]?.description).toBe('COFFEE SHOP');
  });
});

describe('fetchTrueLayerTransactions — credit card (/cards/) path', () => {
  const cardRequest = {
    account: 'barclaycard' as const,
    trueLayerAccountId: TRUE_LAYER_CARD_ID,
    dateFrom: DATE_FROM,
    dateTo: DATE_TO,
    currency: 'GBP',
  };

  it('fetches from /data/v1/cards/{id}/transactions and negates card amounts', async () => {
    const { fetch, calls } = tokenThenTransactionsFetch([
      makeTrueLayerTransactionsEnvelope(canonicalTrueLayerCardRawTransactions),
    ]);

    const result = await fetchTrueLayerTransactions(cardRequest, {
      ...trueLayerDeps(fetch),
      getRefreshTokenSource: () => ({
        refreshToken: 'refresh-token-original',
        tokenAccount: 'barclaycard',
      }),
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject(expectedMappedFeedTransactionRows[0]);
    expect(result.rows[1]).toMatchObject(expectedMappedFeedTransactionRows[1]);

    const txUrl = calls[1]?.url;
    expect(txUrl?.pathname).toBe(`/data/v1/cards/${TRUE_LAYER_CARD_ID}/transactions`);
    expect(txUrl?.pathname).not.toContain('/accounts/');
  });
});

describe('fetchTrueLayerTransactions — error paths', () => {
  it('throws not-linked when refresh token source is missing', async () => {
    await expect(
      fetchTrueLayerTransactions(baseRequest, {
        fetch: makeFetch([]).fetch,
        apiBase: API_BASE,
        authBase: AUTH_BASE,
        getRefreshTokenSource: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'not-linked' });
  });

  it('maps 401 on transactions GET → expired-session', async () => {
    const { fetch } = makeFetch([
      { body: tokenRefreshBody },
      { ok: false, status: 401, statusText: 'Unauthorized', body: { error: 'unauthorized' } },
    ]);

    await expect(
      fetchTrueLayerTransactions(baseRequest, trueLayerDeps(fetch)),
    ).rejects.toMatchObject({ code: 'expired-session' });
  });

  it('maps non-2xx on transactions GET → http-error', async () => {
    const { fetch } = makeFetch([
      { body: tokenRefreshBody },
      { ok: false, status: 500, statusText: 'Server Error', body: { error: 'internal' } },
    ]);

    await expect(
      fetchTrueLayerTransactions(baseRequest, trueLayerDeps(fetch)),
    ).rejects.toMatchObject({ code: 'http-error' });
  });

  it('throws invalid-response when row currency mismatches the account currency', async () => {
    const { fetch } = tokenThenTransactionsFetch([
      makeTrueLayerTransactionsEnvelope([
        { ...canonicalTrueLayerDebitPurchase, currency: 'USD' },
      ]),
    ]);

    await expect(
      fetchTrueLayerTransactions(baseRequest, trueLayerDeps(fetch)),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('throws invalid-response when the response envelope is malformed', async () => {
    const { fetch } = makeFetch([
      { body: tokenRefreshBody },
      { body: { unexpected: 'shape' } },
    ]);

    await expect(
      fetchTrueLayerTransactions(baseRequest, trueLayerDeps(fetch)),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('throws invalid-response when the response is not JSON', async () => {
    const calls: RecordedCall[] = [];
    let i = 0;
    const responses = [
      { body: tokenRefreshBody },
      { body: 'not-json', status: 200 },
    ];
    const fetchImpl: FetchLike = async (input, init) => {
      const url = input instanceof URL ? input : new URL(input.toString());
      calls.push({ url, init });
      const r = responses[i++];
      if (r === undefined) throw new Error('out of responses');
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
      } as globalThis.Response;
    };

    await expect(
      fetchTrueLayerTransactions(baseRequest, trueLayerDeps(fetchImpl)),
    ).rejects.toBeInstanceOf(TrueLayerError);
  });
});

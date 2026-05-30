/**
 * Tests for TrueLayer Data API list endpoints (`/accounts`, `/cards`).
 */

import { describe, it, expect } from 'vitest';
import {
  listTrueLayerDataAccounts,
  listTrueLayerDataCards,
  type FetchLike,
} from './truelayer-auth-http.js';

interface FakeResponse {
  readonly ok?: boolean;
  readonly status?: number;
  readonly body: unknown;
}

function makeFetch(responses: readonly FakeResponse[]): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    const url = input instanceof URL ? input.toString() : input.toString();
    urls.push(url);
    void init;
    const r = responses[i++];
    if (r === undefined) {
      throw new Error(`Fake fetch ran out of responses at call ${i.toString()}`);
    }
    const status = r.status ?? 200;
    return {
      ok: r.ok ?? (status >= 200 && status < 300),
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    } as globalThis.Response;
  };
  return { fetch: fetchImpl, urls };
}

const API_BASE = 'https://api.test';

describe('listTrueLayerDataAccounts', () => {
  it('returns parsed account rows', async () => {
    const { fetch, urls } = makeFetch([
      {
        body: {
          results: [
            { account_id: 'acct-1', display_name: 'Current', account_type: 'TRANSACTION' },
          ],
        },
      },
    ]);

    const results = await listTrueLayerDataAccounts('access-token', {
      fetch,
      apiBase: API_BASE,
    });

    expect(results).toEqual([
      { account_id: 'acct-1', display_name: 'Current', account_type: 'TRANSACTION' },
    ]);
    expect(urls[0]).toBe(`${API_BASE}/data/v1/accounts`);
  });

  it('maps non-2xx to http-error', async () => {
    const { fetch } = makeFetch([{ ok: false, status: 503, body: { error: 'down' } }]);

    await expect(
      listTrueLayerDataAccounts('access-token', { fetch, apiBase: API_BASE }),
    ).rejects.toMatchObject({ code: 'http-error' });
  });
});

describe('listTrueLayerDataCards', () => {
  it('returns parsed card rows', async () => {
    const { fetch, urls } = makeFetch([
      {
        body: {
          results: [{ account_id: 'card-1', display_name: 'Barclaycard' }],
        },
      },
    ]);

    const results = await listTrueLayerDataCards('access-token', {
      fetch,
      apiBase: API_BASE,
    });

    expect(results).toEqual([{ account_id: 'card-1', display_name: 'Barclaycard' }]);
    expect(urls[0]).toBe(`${API_BASE}/data/v1/cards`);
  });

  it('maps malformed JSON envelope to invalid-response', async () => {
    const { fetch } = makeFetch([{ body: { unexpected: true } }]);

    await expect(
      listTrueLayerDataCards('access-token', { fetch, apiBase: API_BASE }),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });
});

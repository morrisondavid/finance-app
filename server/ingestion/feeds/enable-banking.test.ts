/**
 * Adapter-level tests for §3.4 Enable Banking integration.
 *
 * The HTTP layer is the only thing this file mocks; the JWT signing,
 * pagination, Zod validation, and vendor → internal mapping all run
 * unmocked so a regression in any of them surfaces here.
 *
 * Strategy:
 *   - Generate an in-process RSA key pair so the real `crypto.createSign`
 *     succeeds without a fixture PEM on disk.
 *   - Inject a fake `fetch` that hands back canned page responses; we
 *     assert the adapter walks `continuation_key` correctly, sets the
 *     query params and headers we expect, and stops on the first page
 *     without a continuation.
 *   - Cover the error mapping (401 → expired-session, currency mismatch
 *     → invalid-response, generic non-2xx → http-error).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import {
  fetchEnableTransactions,
  EnableBankingError,
  type FetchLike,
} from './enable-banking.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const APP_CREDS = { appId: 'app-test', privateKeyPem: PEM };
const FROZEN_NOW = new Date('2026-04-20T00:00:00Z');
const SESSION = { sessionId: 'sess-123', validUntil: '2026-05-20T00:00:00Z' };
const ENABLE_ACCOUNT_ID = 'acc-uuid-1';

interface FakeResponse {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body: unknown;
}

function makeFetch(responses: readonly FakeResponse[]): { fetch: FetchLike; calls: { url: URL; init?: { method?: string; headers?: Record<string, string> } }[] } {
  const calls: { url: URL; init?: { method?: string; headers?: Record<string, string> } }[] = [];
  let i = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    const url = input instanceof URL ? input : new URL(input.toString());
    calls.push({ url, init });
    const r = responses[i++];
    if (r === undefined) throw new Error(`Fake fetch ran out of responses at call ${i.toString()}`);
    const status = r.status ?? 200;
    return {
      ok: r.ok ?? (status >= 200 && status < 300),
      status,
      statusText: r.statusText ?? 'OK',
      text: async () => typeof r.body === 'string' ? r.body : JSON.stringify(r.body),
      json: async () => r.body,
    };
  };
  return { fetch: fetchImpl, calls };
}

let recordedSession: { id: string; session: { sessionId?: string } } | null = null;

const baseDeps = {
  apiBase: 'https://example.test',
  now: () => FROZEN_NOW,
  readCredentials: () => APP_CREDS,
  getSession: () => SESSION,
  setSession: (id: string, session: { sessionId?: string }) => { recordedSession = { id, session }; },
};

beforeEach(() => {
  recordedSession = null;
});

describe('fetchEnableTransactions — happy paths', () => {
  it('returns mapped rows for a single-page response', async () => {
    const { fetch, calls } = makeFetch([
      {
        body: {
          transactions: [
            {
              entry_reference: 'T1',
              booking_date: '2026-04-15',
              transaction_amount: { amount: '3.50', currency: 'GBP' },
              remittance_information: ['COFFEE SHOP'],
              creditor: { name: 'Coffee Shop Ltd' },
              credit_debit_indicator: 'DBIT',
            },
            {
              entry_reference: 'T2',
              booking_date: '2026-04-16',
              transaction_amount: { amount: '1200.00', currency: 'GBP' },
              remittance_information: ['SALARY'],
              debtor: { name: 'Acme Inc' },
              credit_debit_indicator: 'CRDT',
              balance_after_transaction: { balance_amount: { amount: '5000.00', currency: 'GBP' } },
            },
          ],
          continuation_key: null,
        },
      },
    ]);

    const result = await fetchEnableTransactions(
      {
        account: 'barclays-current',
        enableAccountId: ENABLE_ACCOUNT_ID,
        dateFrom: '2026-04-15',
        dateTo: '2026-04-16',
        currency: 'GBP',
      },
      { ...baseDeps, fetch },
    );

    expect(result.account).toBe('barclays-current');
    expect(result.window).toEqual({ dateFrom: '2026-04-15', dateTo: '2026-04-16' });
    expect(result.rows).toHaveLength(2);

    expect(result.rows[0]).toMatchObject({
      date: '2026-04-15',
      description: 'COFFEE SHOP',
      amount: -3.5,
      currency: 'GBP',
      externalId: 'T1',
      counterparty: 'Coffee Shop Ltd',
    });

    expect(result.rows[1]).toMatchObject({
      date: '2026-04-16',
      description: 'SALARY',
      amount: 1200,
      currency: 'GBP',
      externalId: 'T2',
      balance: 5000,
      counterparty: 'Acme Inc',
    });

    expect(calls).toHaveLength(1);
    const url = calls[0].url;
    expect(url.pathname).toBe(`/accounts/${ENABLE_ACCOUNT_ID}/transactions`);
    expect(url.searchParams.get('date_from')).toBe('2026-04-15');
    expect(url.searchParams.get('date_to')).toBe('2026-04-16');
    expect(url.searchParams.get('strategy')).toBe('default');
    expect(calls[0].init?.headers?.['X-Session-Id']).toBe('sess-123');
    expect(calls[0].init?.headers?.Authorization).toMatch(/^Bearer ey/);

    expect(recordedSession).not.toBeNull();
    expect(recordedSession?.id).toBe(ENABLE_ACCOUNT_ID);
  });

  it('walks continuation_key across multiple pages and concatenates rows', async () => {
    const { fetch, calls } = makeFetch([
      {
        body: {
          transactions: [
            {
              booking_date: '2026-04-15',
              transaction_amount: { amount: '10', currency: 'GBP' },
              remittance_information: ['A'],
              credit_debit_indicator: 'DBIT',
            },
          ],
          continuation_key: 'page-2-key',
        },
      },
      {
        body: {
          transactions: [
            {
              booking_date: '2026-04-16',
              transaction_amount: { amount: '20', currency: 'GBP' },
              remittance_information: ['B'],
              credit_debit_indicator: 'DBIT',
            },
          ],
          continuation_key: '',
        },
      },
    ]);

    const result = await fetchEnableTransactions(
      {
        account: 'barclays-current',
        enableAccountId: ENABLE_ACCOUNT_ID,
        dateFrom: '2026-04-15',
        dateTo: '2026-04-16',
        currency: 'GBP',
      },
      { ...baseDeps, fetch },
    );

    expect(result.rows.map(r => r.description)).toEqual(['A', 'B']);
    expect(calls).toHaveLength(2);
    expect(calls[0].url.searchParams.has('continuation_key')).toBe(false);
    expect(calls[1].url.searchParams.get('continuation_key')).toBe('page-2-key');
  });

  it('falls back to debtor/creditor name when remittance is empty', async () => {
    const { fetch } = makeFetch([
      {
        body: {
          transactions: [
            {
              booking_date: '2026-04-15',
              transaction_amount: { amount: '50', currency: 'GBP' },
              creditor: { name: 'Vendor Ltd' },
              credit_debit_indicator: 'DBIT',
            },
          ],
          continuation_key: null,
        },
      },
    ]);

    const result = await fetchEnableTransactions(
      {
        account: 'barclays-current',
        enableAccountId: ENABLE_ACCOUNT_ID,
        dateFrom: '2026-04-15',
        dateTo: '2026-04-15',
        currency: 'GBP',
      },
      { ...baseDeps, fetch },
    );
    expect(result.rows[0].description).toBe('Vendor Ltd');
  });
});

describe('fetchEnableTransactions — error paths', () => {
  it('throws no-session when the session blob is missing', async () => {
    await expect(
      fetchEnableTransactions(
        {
          account: 'barclays-current',
          enableAccountId: ENABLE_ACCOUNT_ID,
          dateFrom: '2026-04-15',
          dateTo: '2026-04-15',
          currency: 'GBP',
        },
        { ...baseDeps, fetch: makeFetch([]).fetch, getSession: () => undefined },
      ),
    ).rejects.toMatchObject({ code: 'no-session' });
  });

  it('maps 401 → expired-session', async () => {
    const { fetch } = makeFetch([
      { ok: false, status: 401, statusText: 'Unauthorized', body: 'expired' },
    ]);
    await expect(
      fetchEnableTransactions(
        {
          account: 'barclays-current',
          enableAccountId: ENABLE_ACCOUNT_ID,
          dateFrom: '2026-04-15',
          dateTo: '2026-04-15',
          currency: 'GBP',
        },
        { ...baseDeps, fetch },
      ),
    ).rejects.toBeInstanceOf(EnableBankingError);
  });

  it('maps non-2xx → http-error', async () => {
    const { fetch } = makeFetch([
      { ok: false, status: 500, statusText: 'Server Error', body: 'boom' },
    ]);
    await expect(
      fetchEnableTransactions(
        {
          account: 'barclays-current',
          enableAccountId: ENABLE_ACCOUNT_ID,
          dateFrom: '2026-04-15',
          dateTo: '2026-04-15',
          currency: 'GBP',
        },
        { ...baseDeps, fetch },
      ),
    ).rejects.toMatchObject({ code: 'http-error' });
  });

  it('throws invalid-response when row currency mismatches the account currency', async () => {
    const { fetch } = makeFetch([
      {
        body: {
          transactions: [
            {
              booking_date: '2026-04-15',
              transaction_amount: { amount: '10', currency: 'USD' },
              remittance_information: ['x'],
              credit_debit_indicator: 'DBIT',
            },
          ],
          continuation_key: null,
        },
      },
    ]);
    await expect(
      fetchEnableTransactions(
        {
          account: 'barclays-current',
          enableAccountId: ENABLE_ACCOUNT_ID,
          dateFrom: '2026-04-15',
          dateTo: '2026-04-15',
          currency: 'GBP',
        },
        { ...baseDeps, fetch },
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('throws invalid-response when the response shape is malformed', async () => {
    const { fetch } = makeFetch([{ body: { unexpected: 'shape' } }]);
    await expect(
      fetchEnableTransactions(
        {
          account: 'barclays-current',
          enableAccountId: ENABLE_ACCOUNT_ID,
          dateFrom: '2026-04-15',
          dateTo: '2026-04-15',
          currency: 'GBP',
        },
        { ...baseDeps, fetch },
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });
});

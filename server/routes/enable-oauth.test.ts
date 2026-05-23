/**
 * Enable Banking OAuth routes: POST /enable/start, GET /enable/callback
 * (mounted under /api/feed in production).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type { EnableFeedStartResponse } from '../../shared/api-contracts.js';

const hoisted = vi.hoisted(() => ({
  fetchEnableAuthRedirectUrl: vi.fn(),
  exchangeEnableAuthorizationCode: vi.fn(),
  createEnableOAuthState: vi.fn(),
  consumeEnableOAuthState: vi.fn(),
  mergeEnableBankingSessionForAccounts: vi.fn(),
  upsertEnableAccountLink: vi.fn(),
}));

vi.mock('../ingestion/feeds/enable-auth-http.js', () => ({
  fetchEnableAuthRedirectUrl: hoisted.fetchEnableAuthRedirectUrl,
  exchangeEnableAuthorizationCode: hoisted.exchangeEnableAuthorizationCode,
}));

vi.mock('../ingestion/feeds/enable-oauth-state.js', () => ({
  createEnableOAuthState: hoisted.createEnableOAuthState,
  consumeEnableOAuthState: hoisted.consumeEnableOAuthState,
  __clearEnableOAuthStateForTests: vi.fn(),
}));

vi.mock('../ingestion/feeds/enable-session-store.js', async () => {
  const actual = await vi.importActual<typeof import('../ingestion/feeds/enable-session-store.js')>(
    '../ingestion/feeds/enable-session-store.js',
  );
  return {
    ...actual,
    mergeEnableBankingSessionForAccounts: hoisted.mergeEnableBankingSessionForAccounts,
  };
});

vi.mock('../ingestion/feeds/enable-account-links-csv.js', async () => {
  const actual = await vi.importActual<typeof import('../ingestion/feeds/enable-account-links-csv.js')>(
    '../ingestion/feeds/enable-account-links-csv.js',
  );
  return {
    ...actual,
    upsertEnableAccountLink: hoisted.upsertEnableAccountLink,
  };
});

const { default: feedRouter } = await import('./feed.js');

let server: Server;
let baseUrl: string;
const prevRedirect = process.env.ENABLE_BANKING_REDIRECT_URL;
const prevNodeEnv = process.env.NODE_ENV;

beforeAll(async () => {
  process.env.ENABLE_BANKING_REDIRECT_URL = 'http://127.0.0.1:3000/api/feed/enable/callback';
  process.env.NODE_ENV = 'development';
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
  if (prevRedirect === undefined) {
    delete process.env.ENABLE_BANKING_REDIRECT_URL;
  } else {
    process.env.ENABLE_BANKING_REDIRECT_URL = prevRedirect;
  }
  process.env.NODE_ENV = prevNodeEnv;
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  }
});

beforeEach(() => {
  hoisted.fetchEnableAuthRedirectUrl.mockReset();
  hoisted.exchangeEnableAuthorizationCode.mockReset();
  hoisted.createEnableOAuthState.mockReset();
  hoisted.consumeEnableOAuthState.mockReset();
  hoisted.mergeEnableBankingSessionForAccounts.mockReset();
  hoisted.upsertEnableAccountLink.mockReset();
});

describe('POST /api/feed/enable/start', () => {
  it('returns Enable auth URL + state', async () => {
    hoisted.createEnableOAuthState.mockReturnValue('csrf-nonce');
    hoisted.fetchEnableAuthRedirectUrl.mockResolvedValue('https://enable.example.com/psu');

    const res = await fetch(`${baseUrl}/api/feed/enable/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account: 'santander-everyday',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as EnableFeedStartResponse;
    expect(body.url).toBe('https://enable.example.com/psu');
    expect(body.state).toBe('csrf-nonce');
    expect(hoisted.fetchEnableAuthRedirectUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        country: 'ES',
        aspspName: 'Mock ASPSP',
        psuType: 'personal',
        state: 'csrf-nonce',
        redirectUrl: 'http://127.0.0.1:3000/api/feed/enable/callback',
      }),
    );
  });

  it('defaults psuType to business when account category is business', async () => {
    hoisted.createEnableOAuthState.mockReturnValue('csrf-barclays');
    hoisted.fetchEnableAuthRedirectUrl.mockResolvedValue('https://enable.example.com/psu');

    const res = await fetch(`${baseUrl}/api/feed/enable/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account: 'barclays-current',
        country: 'GB',
        aspspName: 'Barclays Business',
      }),
    });

    expect(res.status).toBe(200);
    expect(hoisted.fetchEnableAuthRedirectUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        country: 'GB',
        aspspName: 'Barclays Business',
        psuType: 'business',
        state: 'csrf-barclays',
        redirectUrl: 'http://127.0.0.1:3000/api/feed/enable/callback',
      }),
    );
  });

  it('503 when ENABLE_BANKING_REDIRECT_URL is missing', async () => {
    delete process.env.ENABLE_BANKING_REDIRECT_URL;
    const res = await fetch(`${baseUrl}/api/feed/enable/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'santander-everyday', country: 'ES', aspspName: 'X' }),
    });
    expect(res.status).toBe(503);
    process.env.ENABLE_BANKING_REDIRECT_URL = 'http://127.0.0.1:3000/api/feed/enable/callback';
  });
});

describe('GET /api/feed/enable/callback', () => {
  it('302 and binds link when exactly one uid', async () => {
    hoisted.consumeEnableOAuthState.mockReturnValue('santander-everyday');
    hoisted.exchangeEnableAuthorizationCode.mockResolvedValue({
      sessionId: 'sess-1',
      uids: ['uid-only'],
    });

    const res = await fetch(
      `${baseUrl}/api/feed/enable/callback?code=auth-code&state=opaque`,
      { redirect: 'manual' },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?enableLinked=1');
    expect(hoisted.mergeEnableBankingSessionForAccounts).toHaveBeenCalledWith('sess-1', ['uid-only']);
    expect(hoisted.upsertEnableAccountLink).toHaveBeenCalledWith('santander-everyday', 'uid-only');
  });

  it('200 HTML when multiple uids (operator maps in CSV)', async () => {
    hoisted.consumeEnableOAuthState.mockReturnValue('santander-everyday');
    hoisted.exchangeEnableAuthorizationCode.mockResolvedValue({
      sessionId: 'sess-1',
      uids: ['uid-a', 'uid-b'],
    });

    const res = await fetch(
      `${baseUrl}/api/feed/enable/callback?code=auth-code&state=opaque`,
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('enable-account-links.csv');
    expect(html).toContain('uid-a');
    expect(html).toContain('uid-b');
    expect(hoisted.mergeEnableBankingSessionForAccounts).toHaveBeenCalled();
    expect(hoisted.upsertEnableAccountLink).not.toHaveBeenCalled();
  });
});

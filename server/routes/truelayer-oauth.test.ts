/**
 * TrueLayer OAuth routes: POST `/truelayer/start`, GET `/truelayer/callback`
 * (mounted under `/api/feed` in production).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type { TrueLayerFeedStartResponse } from '../../shared/api-contracts.js';
import * as accountsIndex from '../domain/accounts/index.js';
import { ACCOUNT_CONFIG_DATA } from '../domain/accounts/data.js';

const hoisted = vi.hoisted(() => ({
  exchangeTrueLayerAuthorizationCode: vi.fn(),
  listTrueLayerDataAccounts: vi.fn(),
  listTrueLayerDataCards: vi.fn(),
  createTrueLayerOAuthState: vi.fn(),
  consumeTrueLayerOAuthState: vi.fn(),
  setTrueLayerRefreshToken: vi.fn(),
  upsertTrueLayerAccountLink: vi.fn(),
}));

vi.mock('../ingestion/feeds/truelayer/truelayer-auth-http.js', async () => {
  const actual = await vi.importActual<
    typeof import('../ingestion/feeds/truelayer/truelayer-auth-http.js')
  >('../ingestion/feeds/truelayer/truelayer-auth-http.js');
  return {
    ...actual,
    exchangeTrueLayerAuthorizationCode: hoisted.exchangeTrueLayerAuthorizationCode,
    listTrueLayerDataAccounts: hoisted.listTrueLayerDataAccounts,
    listTrueLayerDataCards: hoisted.listTrueLayerDataCards,
  };
});

vi.mock('../ingestion/feeds/truelayer/truelayer-oauth-state.js', () => ({
  createTrueLayerOAuthState: hoisted.createTrueLayerOAuthState,
  consumeTrueLayerOAuthState: hoisted.consumeTrueLayerOAuthState,
}));

vi.mock('../ingestion/feeds/truelayer/truelayer-tokens.js', async () => {
  const actual = await vi.importActual<typeof import('../ingestion/feeds/truelayer/truelayer-tokens.js')>(
    '../ingestion/feeds/truelayer/truelayer-tokens.js',
  );
  return {
    ...actual,
    setTrueLayerRefreshToken: hoisted.setTrueLayerRefreshToken,
  };
});

vi.mock('../ingestion/feeds/truelayer-account-links-csv.js', async () => {
  const actual = await vi.importActual<
    typeof import('../ingestion/feeds/truelayer-account-links-csv.js')
  >('../ingestion/feeds/truelayer-account-links-csv.js');
  return {
    ...actual,
    upsertTrueLayerAccountLink: hoisted.upsertTrueLayerAccountLink,
  };
});

const { default: feedRouter } = await import('./feed.js');

let server: Server;
let baseUrl: string;

const prevRedirect = process.env.TRUELAYER_REDIRECT_URL;
const prevClientId = process.env.TRUELAYER_CLIENT_ID;
const prevSecret = process.env.TRUELAYER_CLIENT_SECRET;
const prevNodeEnv = process.env.NODE_ENV;

beforeAll(async () => {
  process.env.TRUELAYER_REDIRECT_URL = 'http://127.0.0.1:3000/api/feed/truelayer/callback';
  process.env.TRUELAYER_CLIENT_ID = 'tl-ci-client-id';
  process.env.TRUELAYER_CLIENT_SECRET = 'tl-ci-secret';
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
    delete process.env.TRUELAYER_REDIRECT_URL;
  } else {
    process.env.TRUELAYER_REDIRECT_URL = prevRedirect;
  }
  if (prevClientId === undefined) {
    delete process.env.TRUELAYER_CLIENT_ID;
  } else {
    process.env.TRUELAYER_CLIENT_ID = prevClientId;
  }
  if (prevSecret === undefined) {
    delete process.env.TRUELAYER_CLIENT_SECRET;
  } else {
    process.env.TRUELAYER_CLIENT_SECRET = prevSecret;
  }
  process.env.NODE_ENV = prevNodeEnv;
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  }
});

beforeEach(() => {
  hoisted.exchangeTrueLayerAuthorizationCode.mockReset();
  hoisted.listTrueLayerDataAccounts.mockReset();
  hoisted.listTrueLayerDataCards.mockReset();
  hoisted.createTrueLayerOAuthState.mockReset();
  hoisted.consumeTrueLayerOAuthState.mockReset();
  hoisted.setTrueLayerRefreshToken.mockReset();
  hoisted.upsertTrueLayerAccountLink.mockReset();
});

describe('POST /api/feed/truelayer/start', () => {
  it('503 when TRUELAYER_REDIRECT_URL is missing', async () => {
    delete process.env.TRUELAYER_REDIRECT_URL;
    hoisted.createTrueLayerOAuthState.mockReturnValue('state-x');
    const res = await fetch(`${baseUrl}/api/feed/truelayer/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'barclays-current' }),
    });
    expect(res.status).toBe(503);
    process.env.TRUELAYER_REDIRECT_URL = 'http://127.0.0.1:3000/api/feed/truelayer/callback';
  });

  it('400 when body is invalid JSON shape', async () => {
    const res = await fetch(`${baseUrl}/api/feed/truelayer/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('400 when account has no TrueLayer slice in registry', async () => {
    const spy = vi.spyOn(accountsIndex, 'getAccountConfig').mockReturnValueOnce({
      ...ACCOUNT_CONFIG_DATA.natwest,
      aispFeed: {
        enableBanking: {
          institutionHint: { institutionName: 'NatWest', country: 'GB' },
        },
      },
    });
    const res = await fetch(`${baseUrl}/api/feed/truelayer/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'natwest' }),
    });
    spy.mockRestore();
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error?: string };
    expect(j.error).toMatch(/trueLayer/i);
  });

  it('returns auth URL + state for barclays-current', async () => {
    hoisted.createTrueLayerOAuthState.mockReturnValue('csrf-tl');

    const res = await fetch(`${baseUrl}/api/feed/truelayer/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'barclays-current' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrueLayerFeedStartResponse;
    expect(body.state).toBe('csrf-tl');
    const tlUrl = new URL(body.url);
    expect(tlUrl.hostname).toBe('auth.truelayer.com');
    expect(tlUrl.searchParams.get('response_type')).toBe('code');
    expect(tlUrl.searchParams.get('client_id')).toBeTruthy();
    expect(tlUrl.searchParams.get('provider_id')).toBe('ob-barclays');
    expect(tlUrl.searchParams.get('scope')).toContain('cards');
  });
});

describe('GET /api/feed/truelayer/callback', () => {
  it('302 and upserts CSV link when exactly one TL account returned', async () => {
    hoisted.consumeTrueLayerOAuthState.mockReturnValue('barclays-current');
    hoisted.exchangeTrueLayerAuthorizationCode.mockResolvedValue({
      accessToken: 'acc-1',
      refreshToken: 'rt-store-me',
    });
    hoisted.listTrueLayerDataAccounts.mockResolvedValue([{ account_id: 'acct-only' }]);

    const res = await fetch(`${baseUrl}/api/feed/truelayer/callback?code=z&state=opaque`, {
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?trueLayerLinked=1');
    expect(hoisted.setTrueLayerRefreshToken).toHaveBeenCalledWith('barclays-current', 'rt-store-me');
    expect(hoisted.upsertTrueLayerAccountLink).toHaveBeenCalledWith('barclays-current', 'acct-only');
    expect(hoisted.listTrueLayerDataCards).not.toHaveBeenCalled();
  });

  it('302 and upserts card id when exactly one TL card returned for barclaycard', async () => {
    hoisted.consumeTrueLayerOAuthState.mockReturnValue('barclaycard');
    hoisted.exchangeTrueLayerAuthorizationCode.mockResolvedValue({
      accessToken: 'acc-card',
      refreshToken: 'rt-card',
    });
    hoisted.listTrueLayerDataCards.mockResolvedValue([{ account_id: 'card-only' }]);

    const res = await fetch(`${baseUrl}/api/feed/truelayer/callback?code=z&state=opaque`, {
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    expect(hoisted.setTrueLayerRefreshToken).toHaveBeenCalledWith('barclaycard', 'rt-card');
    expect(hoisted.upsertTrueLayerAccountLink).toHaveBeenCalledWith('barclaycard', 'card-only');
    expect(hoisted.listTrueLayerDataCards).toHaveBeenCalledOnce();
    expect(hoisted.listTrueLayerDataAccounts).not.toHaveBeenCalled();
  });

  it('200 HTML picker form when TL returns multiples', async () => {
    hoisted.consumeTrueLayerOAuthState.mockReturnValue('barclays-current');
    hoisted.exchangeTrueLayerAuthorizationCode.mockResolvedValue({
      accessToken: 'acc-2',
      refreshToken: 'rt2',
    });
    hoisted.listTrueLayerDataAccounts.mockResolvedValue([
      { account_id: 'a', display_name: 'One', account_type: 'uk_retail' },
      { account_id: 'b', display_name: 'Two', account_type: 'uk_savings' },
    ]);

    const res = await fetch(`${baseUrl}/api/feed/truelayer/callback?code=z&state=opaque`);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<form');
    expect(html).toContain('name="truelayerAccountId"');
    expect(html).toContain('value="a"');
    expect(html).toContain('value="b"');
    expect(html).toContain('One');
    expect(html).toContain('Two');
    expect(html).toContain('uk_retail');
    expect(html).toContain('uk_savings');
    expect(hoisted.setTrueLayerRefreshToken).toHaveBeenCalledWith('barclays-current', 'rt2');
    expect(hoisted.upsertTrueLayerAccountLink).not.toHaveBeenCalled();
  });
});

describe('POST /api/feed/truelayer/link', () => {
  it('400 when body is invalid', async () => {
    const res = await fetch(`${baseUrl}/api/feed/truelayer/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(hoisted.upsertTrueLayerAccountLink).not.toHaveBeenCalled();
  });

  it('302 and upserts link when body is valid', async () => {
    const res = await fetch(`${baseUrl}/api/feed/truelayer/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'barclays-current', truelayerAccountId: 'acct-picked' }),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?trueLayerLinked=1');
    expect(hoisted.upsertTrueLayerAccountLink).toHaveBeenCalledWith('barclays-current', 'acct-picked');
  });

  it('302 and upserts link when submitted as form-encoded (HTML picker form)', async () => {
    const res = await fetch(`${baseUrl}/api/feed/truelayer/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'account=monzo-joint&truelayerAccountId=acct-from-form',
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?trueLayerLinked=1');
    expect(hoisted.upsertTrueLayerAccountLink).toHaveBeenCalledWith('monzo-joint', 'acct-from-form');
  });
});

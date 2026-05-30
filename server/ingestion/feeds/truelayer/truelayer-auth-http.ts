/**
 * TrueLayer OAuth2 token endpoints (authorization_code + refresh_token).
 */

import { z } from 'zod';
import { TrueLayerError } from './truelayer-error.js';

export type FetchLike = (
  url: string | URL,
  init?: RequestInit,
) => Promise<globalThis.Response>;

export function resolveTrueLayerAuthBase(override?: string): string {
  if (override !== undefined && override.trim() !== '') return override.replace(/\/$/, '');
  const env = process.env.TRUELAYER_AUTH_BASE?.trim();
  if (env !== undefined && env !== '') return env.replace(/\/$/, '');
  return 'https://auth.truelayer.com';
}

export function resolveTrueLayerApiBase(override?: string): string {
  if (override !== undefined && override.trim() !== '') return override.replace(/\/$/, '');
  const env = process.env.TRUELAYER_API_BASE?.trim();
  if (env !== undefined && env !== '') return env.replace(/\/$/, '');
  return 'https://api.truelayer.com';
}

function readCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.TRUELAYER_CLIENT_ID?.trim();
  const clientSecret = process.env.TRUELAYER_CLIENT_SECRET?.trim();
  if (clientId === undefined || clientId === '') {
    throw new TrueLayerError(
      'missing-credentials',
      'TRUELAYER_CLIENT_ID is not set',
    );
  }
  if (clientSecret === undefined || clientSecret === '') {
    throw new TrueLayerError(
      'missing-credentials',
      'TRUELAYER_CLIENT_SECRET is not set',
    );
  }
  return { clientId, clientSecret };
}

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional(),
});

const OAuthErrorBodySchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

async function parseTokenJson(
  resp: globalThis.Response,
  label: string,
): Promise<z.infer<typeof TokenResponseSchema>> {
  const text = await resp.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (err) {
    throw new TrueLayerError(
      'invalid-response',
      `TrueLayer ${label}: response was not JSON`,
      err,
    );
  }
  if (!resp.ok) {
    const oauthParsed = OAuthErrorBodySchema.safeParse(json);
    if (oauthParsed.success && oauthParsed.data.error === 'invalid_grant') {
      throw new TrueLayerError(
        'expired-session',
        'TrueLayer refresh token revoked or expired — complete the bank link again (POST /api/feed/truelayer/start)',
      );
    }
    const desc =
      typeof (json as { error_description?: string }).error_description === 'string'
        ? `: ${(json as { error_description: string }).error_description}`
        : `: ${text.slice(0, 500)}`;
    throw new TrueLayerError('http-error', `TrueLayer ${label} failed: ${resp.status}${desc}`);
  }
  try {
    return TokenResponseSchema.parse(json);
  } catch (err) {
    throw new TrueLayerError(
      'invalid-response',
      `TrueLayer ${label}: token response shape unexpected`,
      err,
    );
  }
}

export interface ExchangeAuthorizationCodeDeps {
  readonly fetch?: FetchLike;
  readonly authBase?: string;
}

/**
 * Exchange one-time OAuth `code` for access (+ refresh) tokens.
 */
export async function exchangeTrueLayerAuthorizationCode(
  code: string,
  redirectUri: string,
  deps: ExchangeAuthorizationCodeDeps = {},
): Promise<{ accessToken: string; refreshToken: string }> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TrueLayerError(
      'http-error',
      'No fetch implementation available',
    );
  }
  const { clientId, clientSecret } = readCredentials();
  const authBase = resolveTrueLayerAuthBase(deps.authBase);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code: code.trim(),
  });
  const url = `${authBase}/connect/token`;
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const parsed = await parseTokenJson(resp, 'connect/token (authorization_code)');
  const refresh = parsed.refresh_token;
  if (refresh === undefined || refresh === '') {
    throw new TrueLayerError(
      'invalid-response',
      'TrueLayer token response missing refresh_token — ensure offline_access scope is enabled in Console and on the auth link',
    );
  }
  return { accessToken: parsed.access_token, refreshToken: refresh };
}

export interface RefreshAccessTokenDeps {
  readonly fetch?: FetchLike;
  readonly authBase?: string;
}

export async function refreshTrueLayerAccessToken(
  refreshToken: string,
  deps: RefreshAccessTokenDeps = {},
): Promise<{ accessToken: string; refreshToken: string }> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TrueLayerError(
      'http-error',
      'No fetch implementation available',
    );
  }
  const { clientId, clientSecret } = readCredentials();
  const authBase = resolveTrueLayerAuthBase(deps.authBase);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken.trim(),
  });
  const url = `${authBase}/connect/token`;
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const parsed = await parseTokenJson(resp, 'connect/token (refresh_token)');
  const nextRefresh = parsed.refresh_token ?? refreshToken.trim();
  return { accessToken: parsed.access_token, refreshToken: nextRefresh };
}

const DataResourceListItemSchema = z.object({
  account_id: z.string().min(1),
  display_name: z.string().optional(),
  account_type: z.string().optional(),
});

const DataResourceListResponseSchema = z.object({
  results: z.array(DataResourceListItemSchema),
});

export type TrueLayerDataResourceListItem = z.infer<typeof DataResourceListItemSchema>;

export interface ListDataResourcesDeps {
  readonly fetch?: FetchLike;
  readonly apiBase?: string;
}

async function listTrueLayerDataResources(
  accessToken: string,
  resourceSegment: 'accounts' | 'cards',
  deps: ListDataResourcesDeps = {},
): Promise<readonly TrueLayerDataResourceListItem[]> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const apiBase = resolveTrueLayerApiBase(deps.apiBase);
  const label = `/data/v1/${resourceSegment}`;
  const url = `${apiBase}${label}`;
  const resp = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
      Accept: 'application/json',
    },
  });
  const text = await resp.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (err) {
    throw new TrueLayerError(
      'invalid-response',
      `TrueLayer GET ${label}: response was not JSON`,
      err,
    );
  }
  if (!resp.ok) {
    throw new TrueLayerError(
      'http-error',
      `TrueLayer GET ${label} failed: ${resp.status} — ${text.slice(0, 500)}`,
    );
  }
  try {
    const parsed = DataResourceListResponseSchema.parse(json);
    return parsed.results;
  } catch (err) {
    throw new TrueLayerError(
      'invalid-response',
      `TrueLayer GET ${label}: unexpected JSON shape`,
      err,
    );
  }
}

export type ListDataAccountsDeps = ListDataResourcesDeps;

export async function listTrueLayerDataAccounts(
  accessToken: string,
  deps: ListDataAccountsDeps = {},
): Promise<readonly TrueLayerDataResourceListItem[]> {
  return listTrueLayerDataResources(accessToken, 'accounts', deps);
}

export type ListDataCardsDeps = ListDataResourcesDeps;

export async function listTrueLayerDataCards(
  accessToken: string,
  deps: ListDataCardsDeps = {},
): Promise<readonly TrueLayerDataResourceListItem[]> {
  return listTrueLayerDataResources(accessToken, 'cards', deps);
}

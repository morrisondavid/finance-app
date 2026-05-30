/**
 * POST `/api/feed/enable/start` + `/api/feed/truelayer/start` — shared JSON payloads for Express + MCP.
 * OAuth callbacks remain browser-driven (human-required).
 */

import {
  EnableFeedStartBodySchema,
  EnableFeedStartResponseSchema,
  TrueLayerFeedStartBodySchema,
  TrueLayerFeedStartResponseSchema,
} from '../../../shared/api-contracts.js';
import { getAccountConfig, isValidAccountName } from '../../domain/accounts/index.js';
import { fetchEnableAuthRedirectUrl } from '../../ingestion/feeds/enable-auth-http.js';
import { createEnableOAuthState } from '../../ingestion/feeds/enable-oauth-state.js';
import { EnableBankingError } from '../../ingestion/feeds/enable-banking.js';
import { resolveTrueLayerAuthBase } from '../../ingestion/feeds/truelayer/truelayer-auth-http.js';
import { TrueLayerError } from '../../ingestion/feeds/truelayer/truelayer-error.js';
import { createTrueLayerOAuthState } from '../../ingestion/feeds/truelayer/truelayer-oauth-state.js';
import type { JsonMutationResult } from './types.js';

const TL_SCOPES = ['info', 'accounts', 'cards', 'balance', 'transactions', 'offline_access'] as const;

export async function mutateEnableFeedStart(body: unknown): Promise<JsonMutationResult> {
  const parsed = EnableFeedStartBodySchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { error: 'Invalid body', details: parsed.error.issues } };
  }

  const { account, country: bodyCountry, aspspName: bodyAspsp, psuType: bodyPsu } = parsed.data;
  if (!isValidAccountName(account)) {
    return { status: 400, body: { error: 'Unknown account' } };
  }

  let cfg;
  try {
    cfg = getAccountConfig(account);
  } catch {
    return { status: 400, body: { error: 'Unknown account' } };
  }

  const hint = cfg.aispFeed?.enableBanking?.institutionHint;
  const country = bodyCountry ?? hint?.country;
  const aspspName = bodyAspsp ?? hint?.institutionName;
  const defaultPsu = cfg.category === 'business' ? 'business' : 'personal';
  const psuType = bodyPsu ?? defaultPsu;

  if (country === undefined || country.length !== 2) {
    return {
      status: 400,
      body: {
        error:
          'Missing country — pass `country` (ISO-3166-1 alpha-2) or set aispFeed.enableBanking.institutionHint.country on the account',
      },
    };
  }
  if (aspspName === undefined || aspspName.trim() === '') {
    return {
      status: 400,
      body: {
        error:
          'Missing aspspName — pass `aspspName` or set aispFeed.enableBanking.institutionHint.institutionName on the account',
      },
    };
  }

  const redirect = process.env.ENABLE_BANKING_REDIRECT_URL?.trim();
  if (redirect === undefined || redirect === '') {
    return {
      status: 503,
      body: {
        error:
          'ENABLE_BANKING_REDIRECT_URL is not set — must match a URL whitelisted in the Enable Banking Control Panel (e.g. https://yourhost/api/feed/enable/callback)',
      },
    };
  }

  if (process.env.NODE_ENV === 'production' && !redirect.toLowerCase().startsWith('https://')) {
    return {
      status: 503,
      body: { error: 'ENABLE_BANKING_REDIRECT_URL must use https in production' },
    };
  }

  const state = createEnableOAuthState(account);
  try {
    const url = await fetchEnableAuthRedirectUrl({
      country,
      aspspName: aspspName.trim(),
      psuType,
      state,
      redirectUrl: redirect,
    });
    return { status: 200, body: EnableFeedStartResponseSchema.parse({ url, state }) };
  } catch (err) {
    if (err instanceof EnableBankingError) {
      const status =
        err.code === 'missing-credentials' ? 503 : err.code === 'invalid-response' ? 502 : 502;
      return { status, body: { error: err.message, code: err.code } };
    }
    throw err;
  }
}

function readClientId(): string {
  const id = process.env.TRUELAYER_CLIENT_ID?.trim();
  if (id === undefined || id === '') {
    throw new TrueLayerError('missing-credentials', 'TRUELAYER_CLIENT_ID is not set');
  }
  return id;
}

function buildTrueLayerAuthUrl(opts: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly providerId?: string;
  readonly countryId: string;
  readonly authBase?: string;
}): string {
  const authBase = resolveTrueLayerAuthBase(opts.authBase);
  const scope = TL_SCOPES.join(' ');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope,
    state: opts.state,
    providers: 'uk-ob-all',
    country_id: opts.countryId,
  });
  const pid = opts.providerId?.trim();
  if (pid !== undefined && pid !== '') {
    params.set('provider_id', pid);
  }
  const userEmail = process.env.TRUELAYER_END_USER_EMAIL?.trim();
  if (userEmail !== undefined && userEmail !== '') {
    params.set('user_email', userEmail);
  }
  return `${authBase}/?${params.toString()}`;
}

export function mutateTrueLayerFeedStart(body: unknown): JsonMutationResult {
  const parsed = TrueLayerFeedStartBodySchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { error: 'Invalid body', details: parsed.error.issues } };
  }
  const { account, providerId: bodyProviderId, countryId: bodyCountryId } = parsed.data;
  if (!isValidAccountName(account)) {
    return { status: 400, body: { error: 'Unknown account' } };
  }

  let cfg;
  try {
    cfg = getAccountConfig(account);
  } catch {
    return { status: 400, body: { error: 'Unknown account' } };
  }

  if (cfg.aispFeed?.trueLayer === undefined) {
    return {
      status: 400,
      body: {
        error:
          'This account has no aispFeed.trueLayer block — add trueLayer hints under server/domain/accounts/data.ts (see deploy docs)',
      },
    };
  }

  const redirect = process.env.TRUELAYER_REDIRECT_URL?.trim();
  if (redirect === undefined || redirect === '') {
    return {
      status: 503,
      body: {
        error:
          'TRUELAYER_REDIRECT_URL is not set — must match a URI allowlisted in TrueLayer Console (e.g. https://your-host/api/feed/truelayer/callback)',
      },
    };
  }

  if (process.env.NODE_ENV === 'production' && !redirect.toLowerCase().startsWith('https://')) {
    return {
      status: 503,
      body: { error: 'TRUELAYER_REDIRECT_URL must use https in production' },
    };
  }

  try {
    const clientId = readClientId();
    const tl = cfg.aispFeed.trueLayer;
    const providerId = bodyProviderId ?? tl.providerId;
    const countryId = bodyCountryId ?? 'GB';

    const state = createTrueLayerOAuthState(account);
    const url = buildTrueLayerAuthUrl({
      clientId,
      redirectUri: redirect,
      state,
      providerId,
      countryId,
    });
    return { status: 200, body: TrueLayerFeedStartResponseSchema.parse({ url, state }) };
  } catch (err) {
    if (err instanceof TrueLayerError) {
      const status = err.code === 'missing-credentials' ? 503 : 502;
      return { status, body: { error: err.message, code: err.code } };
    }
    throw err;
  }
}

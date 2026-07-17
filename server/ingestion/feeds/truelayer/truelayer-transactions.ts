/**
 * TrueLayer Data API — `/data/v1/accounts/{account_id}/transactions`
 * and `/data/v1/cards/{card_id}/transactions`.
 */

import { z } from 'zod';
import type { AccountName } from '../../../../shared/api-contracts.js';
import type { FeedTransactionRow, InternalFeedTransactions } from '../model.js';
import type { BankParser } from '../../../types.js';
import {
  refreshTrueLayerAccessToken,
  resolveTrueLayerApiBase,
  type FetchLike,
} from './truelayer-auth-http.js';
import { TrueLayerError } from './truelayer-error.js';
import {
  resolveTrueLayerRefreshTokenSource,
  setTrueLayerRefreshToken,
  type TrueLayerRefreshTokenSource,
} from './truelayer-tokens.js';
import {
  trueLayerDataResourceSegment,
  type TrueLayerDataResourceSegment,
} from './truelayer-data-resource.js';
import { defaultTrueLayerRowMapping } from './truelayer-map-helpers.js';
import type { TrueLayerMapContext, TrueLayerRawTransaction } from './truelayer-raw-types.js';
import {
  isTrueLayerFeedCacheEnabled,
  readTrueLayerFeedCache,
  writeTrueLayerFeedCache,
} from './truelayer-feed-cache.js';

export type { TrueLayerMapContext, TrueLayerRawTransaction } from './truelayer-raw-types.js';

/** Matches TrueLayer paging cap pattern used for Enable Banking. */
const MAX_PAGES = 20;

const MetaSchema = z.record(z.string(), z.unknown()).optional();

export const TrueLayerTxnSchema = z
  .object({
    transaction_id: z.string().min(1),
    timestamp: z.string().min(1),
    description: z.string(),
    amount: z.number(),
    currency: z.string().min(3).max(3),
    merchant_name: z.string().optional(),
    provider_transaction_id: z.string().optional(),
    meta: MetaSchema,
    running_balance: z
      .object({
        amount: z.number(),
        currency: z.string().min(3).max(3),
      })
      .optional(),
  })
  .passthrough();

const TransactionsEnvelopeSchema = z
  .object({
    results: z.array(TrueLayerTxnSchema),
  })
  .passthrough();

export interface FetchTrueLayerTransactionsRequest {
  readonly account: AccountName;
  /** TrueLayer `/data/v1/accounts/:id` or `/data/v1/cards/:id` resource id */
  readonly trueLayerAccountId: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly currency: string;
}

export interface FetchTrueLayerTransactionsDeps {
  readonly fetch?: FetchLike;
  readonly apiBase?: string;
  readonly authBase?: string;
  readonly getRefreshTokenSource?: (
    account: AccountName,
  ) => import('./truelayer-tokens.js').TrueLayerRefreshTokenSource | undefined;
  readonly persistRefreshToken?: (account: AccountName, refreshToken: string) => void;
  /** Test override — production uses {@link PARSERS}[account].mapTrueLayerTransaction. */
  readonly mapTrueLayerTransaction?: NonNullable<BankParser['mapTrueLayerTransaction']>;
  /** When true, skip feed JSON cache (feed sync `force`). */
  readonly bypassCache?: boolean;
  /** Test override for cache enablement. */
  readonly feedCacheEnabled?: boolean;
}

function parseRawTransaction(raw: z.infer<typeof TrueLayerTxnSchema>): TrueLayerRawTransaction {
  return raw;
}

async function resolveMapTrueLayerTransaction(
  account: AccountName,
  deps: FetchTrueLayerTransactionsDeps,
): Promise<NonNullable<BankParser['mapTrueLayerTransaction']>> {
  if (deps.mapTrueLayerTransaction !== undefined) {
    return deps.mapTrueLayerTransaction;
  }
  const { PARSERS } = await import('../../../parsers/index.js');
  const parser = PARSERS[account];
  if (parser?.mapTrueLayerTransaction === undefined) {
    throw new TrueLayerError(
      'invalid-response',
      `Parser for ${account} does not implement mapTrueLayerTransaction`,
    );
  }
  return parser.mapTrueLayerTransaction;
}

/**
 * @deprecated Use parser `mapTrueLayerTransaction` — kept for HTTP adapter tests.
 */
export function mapTrueLayerTransactionRow(
  raw: TrueLayerRawTransaction,
  expectedCurrency: string,
  resourceSegment: TrueLayerDataResourceSegment,
): FeedTransactionRow {
  return defaultTrueLayerRowMapping(raw, { currency: expectedCurrency, resourceSegment });
}

/** Optional next-page URL — forward-compatible when TrueLayer adds paging. */
function pickNextHref(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const nextUri = o.next_uri;
  if (typeof nextUri === 'string' && nextUri !== '') return nextUri;
  const links = o.links;
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    if (link === null || typeof link !== 'object') continue;
    const l = link as Record<string, unknown>;
    const rel = typeof l.rel === 'string' ? l.rel : '';
    const href = typeof l.href === 'string' ? l.href : '';
    if ((rel === 'next' || rel === '') && href !== '') {
      return href;
    }
  }
  return null;
}

function resolveRequestUrl(candidate: string, apiBase: string): string {
  if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
    return candidate;
  }
  const path = candidate.startsWith('/') ? candidate : `/${candidate}`;
  return `${apiBase}${path}`;
}

function filterRowsToWindow(
  rows: readonly FeedTransactionRow[],
  dateFrom: string,
  dateTo: string,
): FeedTransactionRow[] {
  return rows.filter(r => r.date >= dateFrom && r.date <= dateTo);
}

function mapRawResultsToRows(
  rawResults: readonly TrueLayerRawTransaction[],
  mapRow: NonNullable<BankParser['mapTrueLayerTransaction']>,
  mapCtx: TrueLayerMapContext,
): FeedTransactionRow[] {
  const out: FeedTransactionRow[] = [];
  for (const raw of rawResults) {
    out.push(mapRow(raw, mapCtx));
  }
  return out;
}

export async function fetchTrueLayerTransactions(
  req: FetchTrueLayerTransactionsRequest,
  deps: FetchTrueLayerTransactionsDeps = {},
): Promise<InternalFeedTransactions> {
  const mapRow = await resolveMapTrueLayerTransaction(req.account, deps);
  const mapCtx: TrueLayerMapContext = {
    currency: req.currency.trim(),
    resourceSegment: trueLayerDataResourceSegment(req.account),
  };

  const cacheEnabled = deps.feedCacheEnabled ?? isTrueLayerFeedCacheEnabled();
  const tlAccountId = req.trueLayerAccountId.trim();

  if (deps.bypassCache !== true && cacheEnabled) {
    const cached = await readTrueLayerFeedCache({
      account: req.account,
      trueLayerAccountId: tlAccountId,
      dateFrom: req.dateFrom,
      dateTo: req.dateTo,
      enabled: cacheEnabled,
    });
    if (cached !== null) {
      const mapped = mapRawResultsToRows(cached.results, mapRow, mapCtx);
      return {
        account: req.account,
        window: { dateFrom: req.dateFrom, dateTo: req.dateTo },
        rows: filterRowsToWindow(mapped, req.dateFrom, req.dateTo),
        trueLayerFetchSource: 'cache',
      };
    }
  }

  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TrueLayerError('http-error', 'No fetch implementation available');
  }

  const getRtSource =
    deps.getRefreshTokenSource ??
    ((account: AccountName): TrueLayerRefreshTokenSource | undefined =>
      resolveTrueLayerRefreshTokenSource(account));
  const persistRt = deps.persistRefreshToken ?? setTrueLayerRefreshToken;

  const tokenSource = getRtSource(req.account);
  if (tokenSource === undefined) {
    throw new TrueLayerError(
      'not-linked',
      'TrueLayer refresh token missing — run POST /api/feed/truelayer/start and complete OAuth',
    );
  }

  let refreshTokenInput = tokenSource.refreshToken;
  const refreshed = await refreshTrueLayerAccessToken(refreshTokenInput, {
    fetch: fetchImpl,
    authBase: deps.authBase,
  });
  if (refreshed.refreshToken !== refreshTokenInput) {
    persistRt(tokenSource.tokenAccount, refreshed.refreshToken);
  }
  const accessToken = refreshed.accessToken;

  const apiBase = resolveTrueLayerApiBase(deps.apiBase);
  const resourceSegment = mapCtx.resourceSegment;
  let nextUrl: string | null =
    `${apiBase}/data/v1/${resourceSegment}/${encodeURIComponent(tlAccountId)}` +
    `/transactions?from=${encodeURIComponent(req.dateFrom)}&to=${encodeURIComponent(req.dateTo)}`;

  const collected: FeedTransactionRow[] = [];
  const rawForCache: TrueLayerRawTransaction[] = [];
  let guard = 0;
  const seenUrls = new Set<string>();

  while (nextUrl !== null && guard < MAX_PAGES) {
    guard++;
    const requestUrl = resolveRequestUrl(nextUrl, apiBase);
    if (seenUrls.has(requestUrl)) break;
    seenUrls.add(requestUrl);
    const resp = await fetchImpl(requestUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        Accept: 'application/json',
      },
    });

    const text = await resp.text();

    let jsonUnknown: unknown;
    try {
      jsonUnknown = JSON.parse(text) as unknown;
    } catch (err) {
      throw new TrueLayerError(
        'invalid-response',
        `TrueLayer GET transactions: response was not JSON (${resp.status})`,
        err,
      );
    }

    if (!resp.ok) {
      if (resp.status === 401) {
        throw new TrueLayerError(
          'expired-session',
          'TrueLayer rejected the access token — complete bank link again (POST /api/feed/truelayer/start)',
        );
      }
      if (resp.status === 403) {
        const errorBody = z.object({ error: z.string().optional() }).safeParse(jsonUnknown);
        if (errorBody.success && errorBody.data.error === 'sca_exceeded') {
          throw new TrueLayerError(
            'sca-exceeded',
            'TrueLayer SCA window expired — complete bank link again (POST /api/feed/truelayer/start)',
          );
        }
      }
      throw new TrueLayerError(
        'http-error',
        `TrueLayer GET transactions failed: ${resp.status} — ${text.slice(0, 500)}`,
      );
    }

    let envelopeParsed: z.infer<typeof TransactionsEnvelopeSchema>;
    try {
      envelopeParsed = TransactionsEnvelopeSchema.parse(jsonUnknown);
    } catch (err) {
      throw new TrueLayerError(
        'invalid-response',
        'TrueLayer GET transactions: unexpected JSON envelope',
        err,
      );
    }

    for (const tx of envelopeParsed.results) {
      const raw = parseRawTransaction(tx);
      rawForCache.push(raw);
      collected.push(mapRow(raw, mapCtx));
    }

    const candidate = pickNextHref(jsonUnknown);
    if (candidate === null || resolveRequestUrl(candidate, apiBase) === requestUrl) {
      nextUrl = null;
    } else {
      nextUrl = candidate;
    }
  }

  if (guard >= MAX_PAGES && nextUrl !== null) {
    throw new TrueLayerError(
      'invalid-response',
      `TrueLayer transactions pagination exceeded ${String(MAX_PAGES)} pages — tighten the date window`,
    );
  }

  if (cacheEnabled) {
    await writeTrueLayerFeedCache({
      account: req.account,
      trueLayerAccountId: tlAccountId,
      dateFrom: req.dateFrom,
      dateTo: req.dateTo,
      results: rawForCache,
      enabled: cacheEnabled,
    });
  }

  const filtered = filterRowsToWindow(collected, req.dateFrom, req.dateTo);

  return {
    account: req.account,
    window: { dateFrom: req.dateFrom, dateTo: req.dateTo },
    rows: filtered,
    trueLayerFetchSource: 'api',
  };
}

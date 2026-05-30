/**
 * TrueLayer Data API — `/data/v1/accounts/{account_id}/transactions`
 * and `/data/v1/cards/{card_id}/transactions`.
 */

import { z } from 'zod';
import type { AccountName } from '../../../../shared/api-contracts.js';
import type { FeedTransactionRow, InternalFeedTransactions } from '../model.js';
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

/** Matches TrueLayer paging cap pattern used for Enable Banking. */
const MAX_PAGES = 20;

const MetaSchema = z.record(z.string(), z.unknown()).optional();

const TrueLayerTxnSchema = z.object({
  transaction_id: z.string().min(1),
  timestamp: z.string().min(1),
  description: z.string(),
  amount: z.number(),
  currency: z.string().min(3).max(3),
  merchant_name: z.string().optional(),
  meta: MetaSchema,
  running_balance: z
    .object({
      amount: z.number(),
      currency: z.string().min(3).max(3),
    })
    .optional(),
});

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
}

function bookingIsoDate(timestamp: string): string {
  const t = timestamp.trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  if (m === null || m[1] === undefined) {
    throw new TrueLayerError(
      'invalid-response',
      `TrueLayer transaction timestamp is not ISO-date-prefixed: ${timestamp}`,
    );
  }
  return m[1];
}

function metaBankTxId(meta: Record<string, unknown> | undefined): string | undefined {
  if (meta === undefined) return undefined;
  const v = meta.bank_transaction_id;
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function mapTransactionRow(
  raw: z.infer<typeof TrueLayerTxnSchema>,
  expectedCurrency: string,
  resourceSegment: TrueLayerDataResourceSegment,
): FeedTransactionRow {
  if (raw.currency !== expectedCurrency) {
    throw new TrueLayerError(
      'invalid-response',
      `TrueLayer transaction ${raw.transaction_id}: currency ${raw.currency} ≠ expected ${expectedCurrency}`,
    );
  }
  let balance: number | undefined;
  if (raw.running_balance !== undefined) {
    if (raw.running_balance.currency !== expectedCurrency) {
      throw new TrueLayerError(
        'invalid-response',
        `TrueLayer transaction ${raw.transaction_id}: running_balance currency mismatch`,
      );
    }
    balance = raw.running_balance.amount;
  }
  const date = bookingIsoDate(raw.timestamp);
  const metaObj = raw.meta ?? {};
  const ref = metaBankTxId(metaObj);

  let description = raw.description;
  const merchant = raw.merchant_name?.trim();
  if (merchant !== undefined && merchant !== '' && description.trim() !== merchant) {
    description = `${description} (${merchant})`.trim();
  }

  /** Card API: charges are typically positive; internal model uses inflow-positive (purchase = negative). */
  const amount = resourceSegment === 'cards' ? -raw.amount : raw.amount;

  const row: FeedTransactionRow = {
    date,
    description,
    amount,
    currency: raw.currency,
    externalId: raw.transaction_id,
  };
  if (balance !== undefined) {
    row.balance = balance;
  }
  if (ref !== undefined) {
    row.reference = ref;
  }
  return row;
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

export async function fetchTrueLayerTransactions(
  req: FetchTrueLayerTransactionsRequest,
  deps: FetchTrueLayerTransactionsDeps = {},
): Promise<InternalFeedTransactions> {
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
  const resourceSegment = trueLayerDataResourceSegment(req.account);
  let nextUrl: string | null =
    `${apiBase}/data/v1/${resourceSegment}/${encodeURIComponent(req.trueLayerAccountId.trim())}` +
    `/transactions?from=${encodeURIComponent(req.dateFrom)}&to=${encodeURIComponent(req.dateTo)}`;

  const collected: FeedTransactionRow[] = [];
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
      collected.push(mapTransactionRow(tx, req.currency.trim(), resourceSegment));
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

  /** Client-side intersect (API may include edge rows outside `[from,to]`). */
  const winFrom = req.dateFrom;
  const winTo = req.dateTo;
  const filtered = collected.filter(r => r.date >= winFrom && r.date <= winTo);

  return {
    account: req.account,
    window: { dateFrom: req.dateFrom, dateTo: req.dateTo },
    rows: filtered,
  };
}

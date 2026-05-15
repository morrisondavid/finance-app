/**
 * Enable Banking adapter — the **only** AISP currently wired in.
 *
 * Public surface:
 *   - {@link fetchEnableTransactions}: given a linked account UUID + ISO
 *     window + session store, return {@link InternalFeedTransactions}.
 *
 * What lives in this file:
 *   - RS256 JWT signing (Node built-in `crypto`, zero new deps).
 *   - HTTP calls to Enable's REST API for transactions + paging.
 *   - Zod validation of every raw response shape.
 *   - Mapping vendor JSON → provider-neutral `InternalFeedTransactions`.
 *
 * What does **not** live here:
 *   - Any iteration over the app's accounts (that's `sync.ts`).
 *   - Window resolution / idempotency (`sync.ts`).
 *   - File I/O for sessions (delegated to `enable-session-store.ts`).
 *
 * Everything vendor-specific dies inside this file. Callers see only
 * `InternalFeedTransactions`.
 *
 * Docs: https://enablebanking.com/docs/api/reference/
 */

import { createSign } from 'crypto';
import fs from 'fs';
import { z } from 'zod';
import type {
  FeedTransactionRow,
  InternalFeedTransactions,
} from './model.js';
import type { AccountName } from '../../../shared/api-contracts.js';
import { getAccountSession, setAccountSession } from './enable-session-store.js';

/** Default base URL — overridable for tests / staging. */
const DEFAULT_API_BASE = 'https://api.enablebanking.com';

/**
 * Enable API origin — `ENABLE_BANKING_API_BASE` when set, else production URL.
 */
export function resolveEnableApiBase(override?: string): string {
  if (override !== undefined && override.trim() !== '') return override;
  const env = process.env.ENABLE_BANKING_API_BASE?.trim();
  if (env !== undefined && env !== '') return env;
  return DEFAULT_API_BASE;
}

/**
 * Mint a short-lived app JWT (`Authorization: Bearer …`) for Enable REST calls.
 * Used by {@link fetchEnableTransactions} and the §3.4 `enable-banking-link` CLI.
 */
export function mintEnableAppJwt(now: Date = new Date()): string {
  return signAppJwt(readAppCredentials(), now);
}

/**
 * Strongly typed error so the upper layers (`runFeedSync`, the route
 * handler, the MCP tool) can surface a meaningful 4xx instead of an
 * opaque 500.
 */
export class EnableBankingError extends Error {
  constructor(
    public readonly code:
      | 'missing-credentials'
      | 'no-session'
      | 'expired-session'
      | 'http-error'
      | 'invalid-response',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EnableBankingError';
  }
}

// ─── Raw response schemas ────────────────────────────────────────────────────

/**
 * One row as Enable returns it (subset — only the fields we map). Field
 * names mirror the Enable docs exactly so it's easy to grep against the
 * reference.
 */
const EnableTransactionRowSchema = z.object({
  entry_reference: z.string().optional(),
  transaction_date: z.string().optional(),
  booking_date: z.string().optional(),
  value_date: z.string().optional(),
  transaction_amount: z.object({
    amount: z.string(),
    currency: z.string().min(3).max(3),
  }),
  remittance_information: z.array(z.string()).optional(),
  creditor: z
    .object({ name: z.string().optional() })
    .partial()
    .optional(),
  debtor: z
    .object({ name: z.string().optional() })
    .partial()
    .optional(),
  credit_debit_indicator: z.enum(['CRDT', 'DBIT']),
  balance_after_transaction: z
    .object({
      balance_amount: z.object({
        amount: z.string(),
        currency: z.string().min(3).max(3),
      }),
    })
    .partial()
    .optional(),
});
export type EnableTransactionRow = z.infer<typeof EnableTransactionRowSchema>;

const EnableTransactionsPageSchema = z.object({
  transactions: z.array(EnableTransactionRowSchema),
  continuation_key: z.string().optional().nullable(),
});

/** App-level credential set — read from env, validated once on first use. */
const EnableAppCredentialsSchema = z.object({
  appId: z.string().min(1),
  privateKeyPem: z.string().min(1),
});
type EnableAppCredentials = z.infer<typeof EnableAppCredentialsSchema>;

function readAppCredentials(): EnableAppCredentials {
  const appId = process.env.ENABLE_BANKING_APP_ID;
  const keyPath = process.env.ENABLE_BANKING_PRIVATE_KEY_PATH;
  const inlineKey = process.env.ENABLE_BANKING_PRIVATE_KEY;

  if (appId === undefined || appId.trim() === '') {
    throw new EnableBankingError(
      'missing-credentials',
      'ENABLE_BANKING_APP_ID is not set; configure your Enable Banking app id before running feed sync',
    );
  }

  let pem: string | undefined;
  if (inlineKey !== undefined && inlineKey.trim() !== '') {
    pem = inlineKey;
  } else if (keyPath !== undefined && keyPath.trim() !== '') {
    if (!fs.existsSync(keyPath)) {
      throw new EnableBankingError(
        'missing-credentials',
        `ENABLE_BANKING_PRIVATE_KEY_PATH points to a non-existent file: ${keyPath}`,
      );
    }
    pem = fs.readFileSync(keyPath, 'utf-8');
  }

  if (pem === undefined || pem.trim() === '') {
    throw new EnableBankingError(
      'missing-credentials',
      'Enable Banking RSA private key is not configured; set ENABLE_BANKING_PRIVATE_KEY_PATH (file path) or ENABLE_BANKING_PRIVATE_KEY (inline PEM)',
    );
  }

  return EnableAppCredentialsSchema.parse({ appId, privateKeyPem: pem });
}

// ─── RS256 JWT signing (built-in crypto) ────────────────────────────────────

/** URL-safe base64 (no padding) per RFC 7515. */
function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sign an Enable Banking app-level JWT. Per the Enable reference:
 *   - alg: RS256
 *   - kid: appId
 *   - iss: 'enablebanking.com'
 *   - aud: 'api.enablebanking.com'
 *   - iat / exp: short window (5 min default)
 */
function signAppJwt(creds: EnableAppCredentials, now: Date = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: creds.appId,
  };
  const payload = {
    iss: 'enablebanking.com',
    aud: 'api.enablebanking.com',
    iat,
    exp: iat + 60 * 5,
  };
  const headerSegment = base64UrlEncode(JSON.stringify(header));
  const payloadSegment = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(creds.privateKeyPem);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

// ─── HTTP layer ─────────────────────────────────────────────────────────────

/**
 * Minimal `fetch` shape — accepts the global `fetch` directly and lets
 * tests inject a fake without monkey-patching. Typed against `Request`/
 * `Response` from Node's built-in `globalThis.fetch` so callers get type
 * safety on shape.
 */
export type FetchLike = (
  input: string | URL,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface FetchEnableTransactionsDeps {
  /** Override for tests / dependency injection. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Override Enable API base URL (e.g. staging). */
  apiBase?: string;
  /** Override the moment used to sign JWTs (tests pin time). */
  now?: () => Date;
  /** Override credential reading (tests bypass env). */
  readCredentials?: () => EnableAppCredentials;
  /** Override session retrieval (tests inject blob without touching disk). */
  getSession?: (accountId: string) => { sessionId?: string; validUntil?: string } | undefined;
  /** Override session persistence (tests inject side-effect-free recorder). */
  setSession?: (accountId: string, session: { sessionId?: string; validUntil?: string }) => void;
}

export interface FetchEnableTransactionsRequest {
  /** App-side bank account that owns the data (used to label the result). */
  account: AccountName;
  /** Enable Banking's UUID for the linked account — `aispFeed.enableBanking.accountId`. */
  enableAccountId: string;
  /** Inclusive ISO `YYYY-MM-DD` window. */
  dateFrom: string;
  /** Inclusive ISO `YYYY-MM-DD` window. */
  dateTo: string;
  /** Expected currency for the account; rows in another currency are rejected hard. */
  currency: string;
}

/**
 * Fetch all transactions for a linked account in `[dateFrom, dateTo]`,
 * paging through `continuation_key` until exhausted.
 *
 * The session blob is loaded from the on-disk store (or the injected
 * `getSession`). When Enable returns 401 (expired), this function throws
 * an `EnableBankingError('expired-session')` so the operator can re-link
 * — automatic re-consent is intentionally out of scope for v1.
 */
export async function fetchEnableTransactions(
  req: FetchEnableTransactionsRequest,
  deps: FetchEnableTransactionsDeps = {},
): Promise<InternalFeedTransactions> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new EnableBankingError(
      'http-error',
      'No fetch implementation available; pass deps.fetch when running on a runtime without globalThis.fetch',
    );
  }

  const apiBase = resolveEnableApiBase(deps.apiBase);
  const now = deps.now ?? (() => new Date());
  const readCreds = deps.readCredentials ?? readAppCredentials;
  const getSess = deps.getSession ?? ((id: string) => getAccountSession(id));
  const setSess = deps.setSession ?? ((id: string, s) => { setAccountSession(id, s); });

  const session = getSess(req.enableAccountId);
  if (session === undefined || session.sessionId === undefined || session.sessionId.trim() === '') {
    throw new EnableBankingError(
      'no-session',
      `No Enable Banking session recorded for account ${req.enableAccountId}; complete the bank-link flow and rerun`,
    );
  }

  // App JWT lets the API trust we're the registered application; the
  // session id (separately persisted from the bank-link flow) authorises
  // access to this specific account.
  const creds = readCreds();
  const appJwt = signAppJwt(creds, now());

  const collected: EnableTransactionRow[] = [];
  let continuationKey: string | undefined;
  // Hard cap on pages so a buggy continuation loop can't peg the worker.
  const MAX_PAGES = 200;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${apiBase}/accounts/${req.enableAccountId}/transactions`);
    url.searchParams.set('date_from', req.dateFrom);
    url.searchParams.set('date_to', req.dateTo);
    url.searchParams.set('strategy', 'default');
    if (continuationKey !== undefined) {
      url.searchParams.set('continuation_key', continuationKey);
    }

    const resp = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        'X-Session-Id': session.sessionId,
        Accept: 'application/json',
      },
    });

    if (resp.status === 401) {
      throw new EnableBankingError(
        'expired-session',
        `Enable Banking returned 401 for account ${req.enableAccountId}; session expired — re-link the account and retry`,
      );
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new EnableBankingError(
        'http-error',
        `Enable Banking GET /transactions failed: ${resp.status} ${resp.statusText}${body !== '' ? ` — ${body}` : ''}`,
      );
    }

    const json: unknown = await resp.json();
    let parsed: z.infer<typeof EnableTransactionsPageSchema>;
    try {
      parsed = EnableTransactionsPageSchema.parse(json);
    } catch (err) {
      throw new EnableBankingError(
        'invalid-response',
        'Enable Banking response did not match the expected transactions-page shape',
        err,
      );
    }
    collected.push(...parsed.transactions);

    if (parsed.continuation_key === undefined || parsed.continuation_key === null || parsed.continuation_key === '') {
      // Touch the session so any sliding-window expiry clock advances —
      // adapter-level housekeeping rather than vendor business logic.
      if (session.sessionId !== undefined) {
        setSess(req.enableAccountId, session);
      }
      return mapToInternal(req, collected);
    }
    continuationKey = parsed.continuation_key;
  }

  throw new EnableBankingError(
    'http-error',
    `Enable Banking transactions paging exceeded ${MAX_PAGES.toString()} pages — refusing to continue`,
  );
}

// ─── Vendor → internal mapping ──────────────────────────────────────────────

function mapToInternal(
  req: FetchEnableTransactionsRequest,
  rows: readonly EnableTransactionRow[],
): InternalFeedTransactions {
  const mapped: FeedTransactionRow[] = [];
  for (const r of rows) {
    const date = pickDate(r);
    if (date === null) continue;

    const rawAmount = parseFloat(r.transaction_amount.amount);
    if (!Number.isFinite(rawAmount)) continue;
    if (r.transaction_amount.currency !== req.currency) {
      throw new EnableBankingError(
        'invalid-response',
        `Enable Banking row currency ${r.transaction_amount.currency} does not match account currency ${req.currency}`,
      );
    }

    // CRDT = credit (money in, positive in our convention)
    // DBIT = debit  (money out, negative in our convention)
    // Enable's `amount` field is always non-negative; the indicator
    // carries the sign.
    const amount = r.credit_debit_indicator === 'CRDT' ? Math.abs(rawAmount) : -Math.abs(rawAmount);

    const description = composeDescription(r);
    const counterparty = r.credit_debit_indicator === 'CRDT'
      ? r.debtor?.name?.trim()
      : r.creditor?.name?.trim();

    const balance = r.balance_after_transaction?.balance_amount?.amount;
    const balanceNum = balance !== undefined ? parseFloat(balance) : undefined;

    const row: FeedTransactionRow = {
      date,
      description,
      amount,
      currency: r.transaction_amount.currency,
    };
    if (balanceNum !== undefined && Number.isFinite(balanceNum)) {
      row.balance = balanceNum;
    }
    if (r.entry_reference !== undefined && r.entry_reference !== '') {
      row.externalId = r.entry_reference;
    }
    if (counterparty !== undefined && counterparty !== '') {
      row.counterparty = counterparty;
    }
    mapped.push(row);
  }

  return {
    account: req.account,
    window: { dateFrom: req.dateFrom, dateTo: req.dateTo },
    rows: mapped,
  };
}

/** Prefer booking date, then transaction date, then value date. */
function pickDate(r: EnableTransactionRow): string | null {
  const candidates = [r.booking_date, r.transaction_date, r.value_date];
  for (const c of candidates) {
    if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c)) return c;
  }
  return null;
}

/**
 * Build a single description string from Enable's array of remittance
 * information lines. Falls back to the counterparty name if the array is
 * empty so the row is never described as just "" (which would break the
 * downstream dedup hash that includes description).
 */
function composeDescription(r: EnableTransactionRow): string {
  const lines = (r.remittance_information ?? []).map(s => s.trim()).filter(s => s !== '');
  if (lines.length > 0) return lines.join(' ');
  const fallback = r.credit_debit_indicator === 'CRDT' ? r.debtor?.name : r.creditor?.name;
  return fallback?.trim() ?? '';
}

/**
 * HTTP helpers for Enable Banking OAuth-style auth + session exchange.
 */

import { z } from 'zod';
import {
  EnableBankingError,
  mintEnableAppJwt,
  resolveEnableApiBase,
} from './enable-banking.js';

function authHeaders(): { Authorization: string; Accept: string } {
  return {
    Authorization: `Bearer ${mintEnableAppJwt()}`,
    Accept: 'application/json',
  };
}

export interface EnableAuthRequestInput {
  readonly country: string;
  readonly aspspName: string;
  readonly psuType: string;
  readonly state: string;
  readonly redirectUrl: string;
}

const EnableAuthResponseSchema = z.object({
  url: z.string().url(),
});

/**
 * POST /auth — returns the PSU redirect URL (bank consent).
 */
export async function fetchEnableAuthRedirectUrl(
  input: EnableAuthRequestInput,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string> {
  const validUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const body = {
    access: { valid_until: validUntil },
    aspsp: { name: input.aspspName, country: input.country },
    state: input.state,
    redirect_url: input.redirectUrl,
    psu_type: input.psuType,
  };
  const base = resolveEnableApiBase();
  const r = await fetchImpl(`${base}/auth`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new EnableBankingError(
      'http-error',
      `Enable Banking POST /auth failed: ${String(r.status)} ${r.statusText}${text !== '' ? ` — ${text}` : ''}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new EnableBankingError('invalid-response', 'Enable POST /auth returned non-JSON');
  }
  const parsed = EnableAuthResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new EnableBankingError('invalid-response', 'Enable POST /auth response missing url');
  }
  return parsed.data.url;
}

export const EnableSessionsResponseSchema = z
  .object({
    session_id: z.string().optional(),
    sessionId: z.string().optional(),
    accounts: z.array(z.object({ uid: z.string() }).passthrough()),
  })
  .passthrough();

export type EnableSessionsResponse = z.infer<typeof EnableSessionsResponseSchema>;

export function pickSessionIdFromEnableSessionsResponse(
  parsed: EnableSessionsResponse,
): string {
  const s = parsed.session_id ?? parsed.sessionId;
  if (s === undefined || s.trim() === '') {
    throw new EnableBankingError(
      'invalid-response',
      'Enable sessions response has neither session_id nor sessionId',
    );
  }
  return s;
}

/**
 * POST /sessions — exchange authorization code for session id + account uids.
 */
export async function exchangeEnableAuthorizationCode(
  code: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ sessionId: string; uids: string[] }> {
  const base = resolveEnableApiBase();
  const r = await fetchImpl(`${base}/sessions`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new EnableBankingError(
      'http-error',
      `Enable Banking POST /sessions failed: ${String(r.status)} ${r.statusText}${text !== '' ? ` — ${text}` : ''}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new EnableBankingError('invalid-response', 'Enable POST /sessions returned non-JSON');
  }
  const parsed = EnableSessionsResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new EnableBankingError(
      'invalid-response',
      'Enable POST /sessions response did not match expected shape',
    );
  }
  const sessionId = pickSessionIdFromEnableSessionsResponse(parsed.data);
  const uids = parsed.data.accounts.map(a => a.uid);
  return { sessionId, uids };
}

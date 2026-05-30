/**
 * Persist TrueLayer OAuth refresh tokens per app account (`AccountName`).
 *
 * Path: `data/truelayer-tokens.local.json` under repo root (`data/` is gitignored),
 * or `TRUELAYER_TOKENS_PATH` when set — same ergonomics as Enable sessions.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { REPO_ROOT } from '../../../repo-root.js';
import { ACCOUNTS, type AccountName } from '../../../../shared/api-contracts.js';
import { getAccountConfig } from '../../../domain/accounts/index.js';
import { uploadOAuthDurableStateToS3 } from '../oauth-durable-upload.js';

/** UK PSD2 AIS re-consent window — used for account-chip amber indicator. */
export const FEED_CONSENT_MAX_DAYS = 90;

const RowSchema = z.object({
  refresh_token: z.string().min(1),
  updated_at: z.string().min(1),
  consent_expires_at: z.string().min(1).optional(),
});

const FileSchema = z.object({
  accounts: z.record(z.string(), RowSchema),
});

export type TrueLayerTokensFile = z.infer<typeof FileSchema>;

function resolvePath(): string {
  const env = process.env.TRUELAYER_TOKENS_PATH?.trim();
  if (env !== undefined && env !== '') return env;
  return path.join(REPO_ROOT, 'data', 'truelayer-tokens.local.json');
}

export function readTrueLayerTokensFile(): TrueLayerTokensFile {
  const p = resolvePath();
  if (!fs.existsSync(p)) {
    return { accounts: {} };
  }
  const raw = fs.readFileSync(p, 'utf-8').trim();
  if (raw === '') return { accounts: {} };
  const parsed: unknown = JSON.parse(raw);
  return FileSchema.parse(parsed);
}

export function writeTrueLayerTokensFile(data: TrueLayerTokensFile): void {
  const p = resolvePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const validated = FileSchema.parse(data);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(validated, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
  uploadOAuthDurableStateToS3('truelayer-tokens');
}

export function getTrueLayerRefreshToken(account: AccountName): string | undefined {
  const row = readTrueLayerTokensFile().accounts[account];
  return row?.refresh_token;
}

export interface TrueLayerRefreshTokenSource {
  readonly refreshToken: string;
  /** Ledger account whose token file row should be updated on rotation. */
  readonly tokenAccount: AccountName;
}

function nonEmptyRefreshToken(account: AccountName): TrueLayerRefreshTokenSource | undefined {
  const token = getTrueLayerRefreshToken(account)?.trim();
  if (token === undefined || token === '') return undefined;
  return { refreshToken: token, tokenAccount: account };
}

/**
 * Refresh token for `account`, falling back to a sibling ledger account that
 * shares the same `aispFeed.trueLayer.providerId` (e.g. barclays-savings
 * reuses barclays-current after one Barclays OAuth).
 */
export function resolveTrueLayerRefreshTokenSource(
  account: AccountName,
): TrueLayerRefreshTokenSource | undefined {
  const own = nonEmptyRefreshToken(account);
  if (own !== undefined) return own;

  let providerId: string | undefined;
  try {
    providerId = getAccountConfig(account).aispFeed?.trueLayer?.providerId?.trim();
  } catch {
    return undefined;
  }
  if (providerId === undefined || providerId === '') return undefined;

  for (const sibling of ACCOUNTS) {
    if (sibling === account) continue;
    try {
      const sibCfg = getAccountConfig(sibling);
      const sibPid = sibCfg.aispFeed?.trueLayer?.providerId?.trim();
      if (sibPid !== providerId) continue;
      const sib = nonEmptyRefreshToken(sibling);
      if (sib !== undefined) return sib;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Token string only — see {@link resolveTrueLayerRefreshTokenSource} for rotation target. */
export function resolveTrueLayerRefreshToken(account: AccountName): string | undefined {
  return resolveTrueLayerRefreshTokenSource(account)?.refreshToken;
}

export type TrueLayerTokenRow = z.infer<typeof RowSchema>;

function addDaysIso(iso: string, days: number): string {
  const base = Date.parse(iso);
  if (!Number.isFinite(base)) {
    throw new Error(`Invalid ISO timestamp: ${iso}`);
  }
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Row for `account` or a sibling sharing the same TrueLayer providerId. */
export function getTrueLayerTokenRow(account: AccountName): TrueLayerTokenRow | undefined {
  const source = resolveTrueLayerRefreshTokenSource(account);
  if (source === undefined) return undefined;
  return readTrueLayerTokensFile().accounts[source.tokenAccount];
}

/**
 * Consent expiry for feed-link indicator — explicit field or `updated_at + 90d`.
 */
export function resolveTrueLayerConsentExpiresAt(account: AccountName): string | undefined {
  const row = getTrueLayerTokenRow(account);
  if (row === undefined) return undefined;
  if (row.consent_expires_at !== undefined && row.consent_expires_at.trim() !== '') {
    return row.consent_expires_at;
  }
  return addDaysIso(row.updated_at, FEED_CONSENT_MAX_DAYS);
}

export function setTrueLayerRefreshToken(account: AccountName, refreshToken: string): void {
  const rt = refreshToken.trim();
  if (rt === '') throw new Error('refreshToken must be non-empty');
  const now = new Date();
  const updatedAt = now.toISOString();
  const consentExpiresAt = addDaysIso(updatedAt, FEED_CONSENT_MAX_DAYS);
  const prev = readTrueLayerTokensFile();
  prev.accounts = {
    ...prev.accounts,
    [account]: {
      refresh_token: rt,
      updated_at: updatedAt,
      consent_expires_at: consentExpiresAt,
    },
  };
  writeTrueLayerTokensFile(prev);
}

/** Test hook: overwrite file path semantics by clearing isn't global — tests use tempfile via env TRUELAYER_TOKENS_PATH in route tests optional */

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
import type { AccountName } from '../../../../shared/api-contracts.js';

const RowSchema = z.object({
  refresh_token: z.string().min(1),
  updated_at: z.string().min(1),
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
}

export function getTrueLayerRefreshToken(account: AccountName): string | undefined {
  const row = readTrueLayerTokensFile().accounts[account];
  return row?.refresh_token;
}

export function setTrueLayerRefreshToken(account: AccountName, refreshToken: string): void {
  const rt = refreshToken.trim();
  if (rt === '') throw new Error('refreshToken must be non-empty');
  const prev = readTrueLayerTokensFile();
  prev.accounts = { ...prev.accounts, [account]: { refresh_token: rt, updated_at: new Date().toISOString() } };
  writeTrueLayerTokensFile(prev);
}

/** Test hook: overwrite file path semantics by clearing isn't global — tests use tempfile via env TRUELAYER_TOKENS_PATH in route tests optional */

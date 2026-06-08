/**
 * Tabular Enable account binding: internal {@link AccountName} → Enable `uid`.
 *
 * Canonical file: `data/enable-account-links.csv`. Runtime values override
 * `aispFeed.enableBanking.accountId` from `data.ts` when present.
 */
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../../repo-root.js';
import type { AccountName } from '../../../shared/api-contracts.js';
import { AccountNameSchema } from '../../../shared/api-contracts.js';
import { escapeCsvField } from '../../utils/csv-helpers.js';
import {
  createCsvDecoders,
  readCsvRecords,
} from '../../utils/csv-decoders.js';
import { recomputeAndPersistDataManifest } from '../../data-manifest.js';
import { writeDurableFileSync } from '../../storage/durable-fs.js';

export const ENABLE_ACCOUNT_LINKS_CSV = path.join(
  REPO_ROOT,
  'data',
  'enable-account-links.csv',
);

const decoders = createCsvDecoders('EnableAccountLink');
const { requireNonEmpty } = decoders;

export const ENABLE_ACCOUNT_LINKS_HEADERS = [
  'account',
  'enable_account_id',
] as const;

export interface EnableAccountLinkRow {
  readonly account: AccountName;
  readonly enableAccountId: string;
}

function csvCell(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function parseRow(raw: Record<string, string>): EnableAccountLinkRow {
  const wide = raw as Record<string, unknown>;
  const rowHint = (csvCell(wide, 'account') ?? '').trim() || '?';
  const account = AccountNameSchema.parse(requireNonEmpty(csvCell(wide, 'account'), 'account', rowHint));
  const enableAccountId = requireNonEmpty(
    csvCell(wide, 'enable_account_id'),
    'enable_account_id',
    rowHint,
  ).trim();
  return { account, enableAccountId };
}

export function readEnableAccountLinks(
  csvPath: string = ENABLE_ACCOUNT_LINKS_CSV,
): ReadonlyMap<AccountName, string> {
  const map = new Map<AccountName, string>();
  if (!fs.existsSync(csvPath)) return map;
  const rawRows = readCsvRecords(csvPath);
  for (const raw of rawRows) {
    const row = parseRow(raw);
    map.set(row.account, row.enableAccountId);
  }
  return map;
}

let linksCache: { path: string; mtimeMs: number; map: ReadonlyMap<AccountName, string> } | null =
  null;

export function getEnableAccountIdFromFile(
  account: AccountName,
  csvPath: string = ENABLE_ACCOUNT_LINKS_CSV,
): string | undefined {
  let statMtime = 0;
  if (fs.existsSync(csvPath)) {
    statMtime = fs.statSync(csvPath).mtimeMs;
  }
  if (
    linksCache === null ||
    linksCache.path !== csvPath ||
    linksCache.mtimeMs !== statMtime
  ) {
    const map = readEnableAccountLinks(csvPath);
    linksCache = { path: csvPath, mtimeMs: statMtime, map };
  }
  return linksCache.map.get(account);
}

/**
 * Replace or append one row for `account`, preserve others, atomic write.
 */
export function upsertEnableAccountLink(
  account: AccountName,
  enableAccountId: string,
  csvPath: string = ENABLE_ACCOUNT_LINKS_CSV,
): void {
  const id = enableAccountId.trim();
  if (id === '') throw new Error('enableAccountId must be non-empty');
  const prev = readEnableAccountLinks(csvPath);
  const next = new Map(prev);
  next.set(account, id);
  writeEnableAccountLinks(next, csvPath);
  linksCache = null;
  recomputeAndPersistDataManifest();
}

export function writeEnableAccountLinks(
  byAccount: ReadonlyMap<AccountName, string>,
  csvPath: string = ENABLE_ACCOUNT_LINKS_CSV,
): void {
  const dir = path.dirname(csvPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const lines: string[] = [[...ENABLE_ACCOUNT_LINKS_HEADERS].join(',')];
  const sorted = [...byAccount.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [acct, uid] of sorted) {
    lines.push(
      [escapeCsvField(acct), escapeCsvField(uid)].join(','),
    );
  }
  writeDurableFileSync(csvPath, `${lines.join('\n')}\n`);
}

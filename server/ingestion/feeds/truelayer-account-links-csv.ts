/**
 * Tabular TrueLayer Data API binding: internal {@link AccountName} →
 * `/data/v1/accounts/{account_id}` resource id (display name differs from TL UI).
 *
 * Canonical file when used: `data/truelayer-account-links.csv`.
 * Overrides `aispFeed.trueLayer.dataAccountId` from registry when present.
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
import { uploadOAuthDurableStateToS3 } from './oauth-durable-upload.js';

export const TRUELAYER_ACCOUNT_LINKS_CSV = path.join(
  REPO_ROOT,
  'data',
  'truelayer-account-links.csv',
);

const decoders = createCsvDecoders('TrueLayerAccountLink');
const { requireNonEmpty } = decoders;

export const TRUELAYER_ACCOUNT_LINKS_HEADERS = [
  'account',
  'truelayer_account_id',
] as const;

export interface TrueLayerAccountLinkRow {
  readonly account: AccountName;
  readonly trueLayerAccountId: string;
}

function csvCell(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function parseRow(raw: Record<string, string>): TrueLayerAccountLinkRow {
  const wide = raw as Record<string, unknown>;
  const rowHint = (csvCell(wide, 'account') ?? '').trim() || '?';
  const account = AccountNameSchema.parse(requireNonEmpty(csvCell(wide, 'account'), 'account', rowHint));
  const trueLayerAccountId = requireNonEmpty(
    csvCell(wide, 'truelayer_account_id'),
    'truelayer_account_id',
    rowHint,
  ).trim();
  return { account, trueLayerAccountId };
}

export function readTrueLayerAccountLinks(
  csvPath: string = TRUELAYER_ACCOUNT_LINKS_CSV,
): ReadonlyMap<AccountName, string> {
  const map = new Map<AccountName, string>();
  if (!fs.existsSync(csvPath)) return map;
  const rawRows = readCsvRecords(csvPath);
  for (const raw of rawRows) {
    const row = parseRow(raw);
    map.set(row.account, row.trueLayerAccountId);
  }
  return map;
}

let linksCache: { path: string; mtimeMs: number; map: ReadonlyMap<AccountName, string> } | null =
  null;

export function getTrueLayerAccountIdFromFile(
  account: AccountName,
  csvPath: string = TRUELAYER_ACCOUNT_LINKS_CSV,
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
    const map = readTrueLayerAccountLinks(csvPath);
    linksCache = { path: csvPath, mtimeMs: statMtime, map };
  }
  return linksCache.map.get(account);
}

/** Replace or append one row for `account`, preserve others, atomic write. */
export function upsertTrueLayerAccountLink(
  account: AccountName,
  trueLayerAccountId: string,
  csvPath: string = TRUELAYER_ACCOUNT_LINKS_CSV,
): void {
  const id = trueLayerAccountId.trim();
  if (id === '') throw new Error('trueLayerAccountId must be non-empty');
  const prev = readTrueLayerAccountLinks(csvPath);
  const next = new Map(prev);
  next.set(account, id);
  writeTrueLayerAccountLinks(next, csvPath);
  linksCache = null;
  recomputeAndPersistDataManifest();
}

export function writeTrueLayerAccountLinks(
  byAccount: ReadonlyMap<AccountName, string>,
  csvPath: string = TRUELAYER_ACCOUNT_LINKS_CSV,
): void {
  const dir = path.dirname(csvPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const lines: string[] = [[...TRUELAYER_ACCOUNT_LINKS_HEADERS].join(',')];
  const sorted = [...byAccount.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [acct, uid] of sorted) {
    lines.push(
      [escapeCsvField(acct), escapeCsvField(uid)].join(','),
    );
  }
  const tmp = `${csvPath}.tmp`;
  fs.writeFileSync(tmp, `${lines.join('\n')}\n`, 'utf-8');
  fs.renameSync(tmp, csvPath);
  uploadOAuthDurableStateToS3('truelayer-account-links');
}

/** Test helper */
export function __clearTrueLayerAccountLinksCacheForTests(): void {
  linksCache = null;
}

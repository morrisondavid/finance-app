/**
 * Fetch real TrueLayer transaction rows and write JSON fixtures for tests.
 *
 * Usage:
 *   tsx scripts/capture-truelayer-fixtures.ts [--write]
 *   ACCOUNT=monzo-joint tsx scripts/capture-truelayer-fixtures.ts --write
 *
 * Requires `data/truelayer-tokens.local.json`, `data/truelayer-account-links.csv`,
 * and TrueLayer credentials in `.env.local`.
 */

import fs from 'fs';
import path from 'path';
import { loadEnvLocal } from '../server/load-env-local.js';
import type { AccountName } from '../shared/api-contracts.js';
import { getAccountConfig } from '../server/domain/accounts/index.js';
import { readTrueLayerAccountLinks } from '../server/ingestion/feeds/truelayer-account-links-csv.js';
import {
  refreshTrueLayerAccessToken,
  resolveTrueLayerApiBase,
} from '../server/ingestion/feeds/truelayer/truelayer-auth-http.js';
import { trueLayerDataResourceSegment } from '../server/ingestion/feeds/truelayer/truelayer-data-resource.js';
import { resolveTrueLayerRefreshTokenSource } from '../server/ingestion/feeds/truelayer/truelayer-tokens.js';
import type { TrueLayerRawTransaction } from '../server/ingestion/feeds/truelayer/truelayer-raw-types.js';
import { REPO_ROOT } from '../server/repo-root.js';

loadEnvLocal();

const FIXTURES_ROOT = path.join(
  REPO_ROOT,
  'server/ingestion/feeds/truelayer/fixtures',
);

function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function slugFromRow(row: TrueLayerRawTransaction, kind: string): string {
  const base = row.description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${kind}-${base || row.transaction_id.slice(0, 8)}`;
}

function pickRepresentativeRows(
  rows: readonly TrueLayerRawTransaction[],
): { slug: string; row: TrueLayerRawTransaction }[] {
  const picked: { slug: string; row: TrueLayerRawTransaction }[] = [];
  const usedIds = new Set<string>();

  function tryPick(
    label: string,
    predicate: (r: TrueLayerRawTransaction) => boolean,
  ): void {
    const row = rows.find(r => !usedIds.has(r.transaction_id) && predicate(r));
    if (row === undefined) return;
    usedIds.add(row.transaction_id);
    picked.push({ slug: slugFromRow(row, label), row });
  }

  tryPick('debit', r => r.amount < 0 && (r.merchant_name?.trim() ?? '') !== '');
  tryPick('credit', r => r.amount > 0);
  tryPick('transfer', r => {
    const cat = r.meta?.provider_category;
    const hasMerchant = (r.merchant_name?.trim() ?? '') !== '';
    return !hasMerchant && typeof cat === 'string' && cat.toLowerCase().includes('pay');
  });
  tryPick('sample', r => true);

  return picked;
}

async function fetchRawTransactions(
  account: AccountName,
  trueLayerAccountId: string,
  dateFrom: string,
  dateTo: string,
): Promise<TrueLayerRawTransaction[]> {
  const tokenSource = resolveTrueLayerRefreshTokenSource(account);
  if (tokenSource === undefined) {
    throw new Error(`${account}: no refresh token`);
  }
  const refreshed = await refreshTrueLayerAccessToken(tokenSource.refreshToken);
  const accessToken = refreshed.accessToken;
  const apiBase = resolveTrueLayerApiBase();
  const segment = trueLayerDataResourceSegment(account);
  const url =
    `${apiBase}/data/v1/${segment}/${encodeURIComponent(trueLayerAccountId)}` +
    `/transactions?from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
      Accept: 'application/json',
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`${account}: GET failed ${String(resp.status)} — ${text.slice(0, 300)}`);
  }
  const body = JSON.parse(text) as { results?: TrueLayerRawTransaction[] };
  return body.results ?? [];
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const singleAccount = process.env.ACCOUNT?.trim() as AccountName | undefined;
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = process.env.DATE_FROM ?? shiftIsoDate(today, -90);
  const dateTo = process.env.DATE_TO ?? today;

  const links = readTrueLayerAccountLinks();
  const accounts = singleAccount !== undefined
    ? [singleAccount]
    : [...links.keys()].sort();

  console.log(`Window: ${dateFrom} → ${dateTo}`);
  console.log(`Accounts: ${accounts.join(', ')}`);
  console.log(`Write fixtures: ${write ? 'yes' : 'dry-run (pass --write)'}\n`);

  for (const account of accounts) {
    const tlId = links.get(account);
    if (tlId === undefined) {
      console.warn(`Skip ${account}: no truelayer_account_id in links CSV`);
      continue;
    }
    const token = resolveTrueLayerRefreshTokenSource(account);
    if (token === undefined) {
      console.warn(`Skip ${account}: no refresh token`);
      continue;
    }

    let currency: string;
    try {
      currency = getAccountConfig(account).currency;
    } catch {
      console.warn(`Skip ${account}: unknown account config`);
      continue;
    }

    console.log(`Fetching ${account} (${currency})…`);
    const rows = await fetchRawTransactions(account, tlId, dateFrom, dateTo);
    console.log(`  ${rows.length} row(s)`);

    const picks = pickRepresentativeRows(rows);
    if (picks.length === 0) {
      console.warn(`  No rows to fixture for ${account}`);
      continue;
    }

    for (const { slug, row } of picks) {
      const rel = path.join('server/ingestion/feeds/truelayer/fixtures', account, `${slug}.json`);
      const abs = path.join(REPO_ROOT, rel);
      console.log(`  → ${rel}`);
      if (write) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, `${JSON.stringify(row, null, 2)}\n`, 'utf-8');
      }
    }
    console.log('');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

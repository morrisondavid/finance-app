/**
 * Load committed TrueLayer API fixture JSON for parser golden tests.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AccountName } from '../../../../shared/api-contracts.js';
import type { TrueLayerRawTransaction } from './truelayer-raw-types.js';

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

export interface TrueLayerFixtureFile {
  readonly account: AccountName;
  readonly slug: string;
  readonly path: string;
  readonly raw: TrueLayerRawTransaction;
}

export function listTrueLayerFixtures(account?: AccountName): TrueLayerFixtureFile[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  const accounts = account !== undefined
    ? [account]
    : fs.readdirSync(FIXTURES_DIR).filter(name =>
      fs.statSync(path.join(FIXTURES_DIR, name)).isDirectory(),
    );

  const out: TrueLayerFixtureFile[] = [];
  for (const acct of accounts) {
    const dir = path.join(FIXTURES_DIR, acct);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      const abs = path.join(dir, file);
      const parsed: unknown = JSON.parse(fs.readFileSync(abs, 'utf-8'));
      if (!isTrueLayerRawTransaction(parsed)) {
        throw new Error(`Invalid fixture JSON: ${abs}`);
      }
      out.push({
        account: acct as AccountName,
        slug: file.replace(/\.json$/, ''),
        path: abs,
        raw: parsed,
      });
    }
  }
  return out;
}

function isTrueLayerRawTransaction(v: unknown): v is TrueLayerRawTransaction {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.transaction_id === 'string'
    && typeof o.timestamp === 'string'
    && typeof o.description === 'string'
    && typeof o.amount === 'number'
    && typeof o.currency === 'string'
  );
}

export function loadTrueLayerFixture(
  account: AccountName,
  slug: string,
): TrueLayerRawTransaction {
  const match = listTrueLayerFixtures(account).find(f => f.slug === slug);
  if (match === undefined) {
    throw new Error(`Missing fixture ${account}/${slug}.json`);
  }
  return match.raw;
}

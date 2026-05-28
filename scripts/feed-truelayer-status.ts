/**
 * Print feed toolbar state for every ledger account (Connect / Sync / hidden).
 *
 * Usage:
 *   npm run feed:truelayer-status
 *   BASE_URL=https://finances.traxiproducts.com BEARER=… npm run feed:truelayer-status
 */

import { ACCOUNTS } from '../shared/api-contracts.js';
import { feedToolbarStateForAccount } from '../server/ingestion/feeds/feed-toolbar-state.js';

const baseUrl = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const bearer = process.env.BEARER ?? process.env.MCP_BEARER_TOKEN ?? process.env.BANK_SITE_ACCESS_SECRET;

async function remoteState(account: string): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (bearer !== undefined && bearer.trim() !== '') {
    headers.Authorization = `Bearer ${bearer.trim()}`;
  }
  const res = await fetch(
    `${baseUrl}/api/dashboard/feed-toolbar-state?account=${encodeURIComponent(account)}`,
    { headers },
  );
  if (!res.ok) {
    return { error: res.status, statusText: res.statusText };
  }
  return res.json();
}

async function main(): Promise<void> {
  const useRemote = process.env.REMOTE === '1' || baseUrl.startsWith('https://');

  console.log(`Feed toolbar state (${useRemote ? 'remote' : 'local'})\n`);

  for (const account of ACCOUNTS) {
    if (useRemote) {
      const state = await remoteState(account);
      console.log(`${account}:`, JSON.stringify(state));
    } else {
      const state = feedToolbarStateForAccount(account);
      console.log(`${account}:`, JSON.stringify(state));
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

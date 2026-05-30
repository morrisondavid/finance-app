/**
 * Fetch TrueLayer Monzo transactions and diagnose Stoneshaw / dedup fields.
 *
 * Usage: tsx scripts/diagnose-truelayer-monzo.ts
 */
import { loadEnvLocal } from '../server/load-env-local.js';
import { fetchTrueLayerTransactions } from '../server/ingestion/feeds/truelayer/truelayer-transactions.js';
import { mapTrueLayerTransactionRow } from '../server/ingestion/feeds/truelayer/truelayer-transactions.js';
import monzoParser from '../server/parsers/monzo.js';
import { getTrueLayerAccountIdFromFile } from '../server/ingestion/feeds/truelayer-account-links-csv.js';

loadEnvLocal();

const accountId = getTrueLayerAccountIdFromFile('monzo-joint');
if (!accountId) {
  console.error('No monzo-joint row in data/truelayer-account-links.csv');
  process.exit(1);
}

const dateFrom = process.env.DATE_FROM ?? '2026-03-01';
const dateTo = process.env.DATE_TO ?? '2026-05-30';

async function main(): Promise<void> {
  console.log(`Fetching TrueLayer monzo-joint ${dateFrom} → ${dateTo} (account ${accountId})…\n`);

  const result = await fetchTrueLayerTransactions({
    account: 'monzo-joint',
    trueLayerAccountId: accountId,
    dateFrom,
    dateTo,
    currency: 'GBP',
  });

  console.log(`Rows: ${result.rows.length}\n`);

  const hunters = result.rows.filter(r =>
    r.description.toUpperCase().includes('HUNTER')
    || r.counterparty?.toUpperCase().includes('HUNTER')
    || r.counterparty?.toUpperCase().includes('STONE')
    || r.description.toUpperCase().includes('STONE'),
  );

  console.log(`Stoneshaw / Hunters matches: ${hunters.length}`);
  for (const row of hunters) {
    console.log('\n--- mapped feed row ---');
    console.log(JSON.stringify(row, null, 2));

    const csv = monzoParser.emitFeedTransactionsAsCsv?.({
      account: 'monzo-joint',
      window: { dateFrom, dateTo },
      rows: [row],
    }) ?? '';
    const firstDataLine = csv.split('\n')[1] ?? '';
    console.log('\n--- emitted CSV data line ---');
    console.log(firstDataLine);

    const records = csv.split('\n').slice(0, 3);
    console.log('\n--- CSV header + row ---');
    console.log(records.join('\n'));
  }

  // Show raw API shape for first hunters match via re-fetch logic — print sample card/income txs
  const income = result.rows.filter(r => r.amount > 500).slice(0, 5);
  console.log('\n=== Sample large credits (mapped) ===');
  for (const row of income) {
    console.log(`${row.date} £${row.amount} desc="${row.description}" cp="${row.counterparty ?? ''}" ref="${row.reference ?? ''}" ext="${row.externalId ?? ''}"`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

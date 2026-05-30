/**
 * Expected ledger `description` after feed row → bank CSV → parser transform.
 *
 * Monzo maps `counterparty` into `Name` (this fix). Barclaycard already used
 * `Merchant Name` = counterparty before this work. All other banks emit
 * `row.description` into their narrative column.
 */
import type { AccountName } from '../../../shared/api-contracts.js';
import type { FeedTransactionRow } from '../../ingestion/feeds/model.js';

export function expectedFeedLedgerDescription(
  account: AccountName,
  row: FeedTransactionRow,
): string {
  if (account === 'monzo-joint' || account === 'barclaycard') {
    return row.counterparty ?? row.description;
  }
  return row.description;
}

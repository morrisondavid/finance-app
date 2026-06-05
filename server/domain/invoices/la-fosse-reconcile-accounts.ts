/**
 * La Fosse deposit account union for invoice reconciliation.
 *
 * Self-bill payments for the same client have landed on different pockets:
 *   - UK Ltd era → Barclays (GBP)
 *   - FZCO era → Emirates Islamic AED / GBP / USD sub-accounts
 *   - Transition mistakes → FZCO invoices on AED, or credits on the wrong entity's account
 *
 * Reconciliation searches the union for a given invoice entity, but each
 * {@link ReconcileTransaction} keeps the **actual** `account` and
 * `deposit_currency` from the bank row so `invoice_payments.csv` records
 * where the money really arrived.
 */

import type { EntityId } from '../../../shared/api-contracts.js';
import type { AccountName } from '../accounts/schema.js';
import { accountsForEntity, getAccountConfig } from '../accounts/queries.js';
import type { ReconcileTransaction } from './reconcile-payments.js';

/** All Emirates Islamic business pockets (AED primary + GBP/USD sub-accounts). */
export const EMIRATES_ISLAMIC_ACCOUNT_NAMES: readonly AccountName[] = [
  'emirates-islamic',
  'emirates-islamic-gbp',
  'emirates-islamic-usd',
];

const UK_LA_FOSSE_FALLBACK_ACCOUNTS: readonly AccountName[] = [
  'barclays-current',
  'barclays-savings',
];

/**
 * Business accounts that may have received a La Fosse deposit for invoices
 * issued under `invoiceEntityId`.
 */
export function laFosseDepositAccountNames(
  invoiceEntityId: EntityId,
): readonly AccountName[] {
  const primary = accountsForEntity(invoiceEntityId);
  if (invoiceEntityId === 'autonize-it-fzco') {
    const extras = UK_LA_FOSSE_FALLBACK_ACCOUNTS.filter(
      name => !primary.includes(name),
    );
    return [...primary, ...extras];
  }
  if (invoiceEntityId === 'autonize-it-ltd') {
    const extras = EMIRATES_ISLAMIC_ACCOUNT_NAMES.filter(
      name => !primary.includes(name),
    );
    return [...primary, ...extras];
  }
  return primary;
}

export interface LoadLaFosseIncomeRowsInput {
  readonly invoiceEntityId: EntityId;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly queryRows: (
    accounts: readonly AccountName[],
    windowStart: string,
    windowEnd: string,
  ) => readonly {
    id: number;
    hash: string;
    date: string;
    description: string;
    amount: number;
    account: string;
  }[];
}

/**
 * Income rows for La Fosse reconciliation. Sets `entityId` on each tx to
 * `invoiceEntityId` so {@link planReconciliation} can pair cross-account
 * deposits with the correct invoice entity while preserving the real account.
 */
export function loadLaFosseReconcileTransactions(
  input: LoadLaFosseIncomeRowsInput,
): readonly ReconcileTransaction[] {
  const accountNames = laFosseDepositAccountNames(input.invoiceEntityId);
  if (accountNames.length === 0) return [];

  const rows = input.queryRows(accountNames, input.windowStart, input.windowEnd);
  const out: ReconcileTransaction[] = [];

  for (const row of rows) {
    const cfg = getAccountConfig(row.account as AccountName);
    if (cfg.category !== 'business') continue;
    out.push({
      id: row.hash,
      date: row.date,
      description: row.description,
      amount: row.amount,
      currency: cfg.currency,
      account: row.account,
      entityId: input.invoiceEntityId,
    });
  }

  return out;
}

/** Parse `SB-293519`, `/INV/SB -293521/`, etc. from bank narratives. */
export function extractLaFosseSupplierRefs(description: string): readonly string[] {
  const refs = new Set<string>();
  for (const match of description.matchAll(/SB\s*-?\s*(\d+)/gi)) {
    const digits = match[1];
    if (digits !== undefined && digits.length > 0) {
      refs.add(`SB-${digits}`);
    }
  }
  return [...refs];
}

/**
 * Emirates remittances often quote the GBP leg in the narrative while the
 * ledger row is AED.
 */
export function laFosseDepositAmountForMatch(
  tx: Pick<ReconcileTransaction, 'amount' | 'currency' | 'description'>,
): number {
  const gbpInNarrative = tx.description.match(/GBP\s+([\d,]+(?:\.\d+)?)/i);
  if (gbpInNarrative !== null && tx.currency !== 'GBP') {
    const parsed = Number(gbpInNarrative[1]!.replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return tx.amount;
}

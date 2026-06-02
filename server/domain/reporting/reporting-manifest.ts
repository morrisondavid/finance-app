import type {
  AccountName,
  EntityId,
  ReportingDocType,
  ReportingRegime,
} from '../../../shared/api-contracts.js';
import { accountsForEntity } from '../accounts/index.js';

/** Accountant packs require official PDF statements and transaction CSVs for every account. */
const REQUIRED_DOC_TYPES: readonly ReportingDocType[] = ['pdf', 'csv'];

export interface ReportingManifest {
  entityId: EntityId;
  regime: ReportingRegime;
  accounts: readonly AccountName[];
  docTypesByAccount: ReadonlyMap<AccountName, readonly ReportingDocType[]>;
  requiresInvoices: boolean;
  graceDays: number;
}

export function getReportingManifest(
  entityId: EntityId,
  regime: ReportingRegime,
): ReportingManifest {
  const accounts = accountsForEntity(entityId);
  const docTypesByAccount = new Map<AccountName, readonly ReportingDocType[]>();
  for (const account of accounts) {
    docTypesByAccount.set(account, REQUIRED_DOC_TYPES);
  }
  const requiresInvoices =
    entityId === 'autonize-it-ltd' &&
    (regime === 'vat' || regime === 'corporation_tax');

  return {
    entityId,
    regime,
    accounts,
    docTypesByAccount,
    requiresInvoices,
    graceDays: 7,
  };
}

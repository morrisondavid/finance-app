import type {
  AccountName,
  EntityId,
  ReportingDocType,
  ReportingRegime,
} from '../../../shared/api-contracts.js';
import { accountsForEntity, reportingDocTypesForAccount } from '../accounts/index.js';

/** Default is PDF + CSV per account; override via `reportingDocTypes` on account config. */

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
    docTypesByAccount.set(account, [...reportingDocTypesForAccount(account)]);
  }
  const requiresInvoices =
    entityId === 'autonize-it-ltd' &&
    (regime === 'vat' || regime === 'corporation_tax' || regime === 'date_range');

  return {
    entityId,
    regime,
    accounts,
    docTypesByAccount,
    requiresInvoices,
    graceDays: 7,
  };
}

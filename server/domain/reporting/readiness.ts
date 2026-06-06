import path from 'node:path';
import {
  ReportingReadinessResponseSchema,
  type EntityId,
  type Invoice,
  type ReportingReadinessItem,
  type ReportingReadinessResponse,
  type ReportingRegime,
} from '../../../shared/api-contracts.js';
import { getTransactions } from '../../db/index.js';
import { getAccountConfig } from '../accounts/index.js';
import { listInvoicesByIssuingEntityId } from '../invoices/index.js';
import { isInvoiceStoredPdfAvailable } from '../invoices/stored-pdf.js';
import { STATEMENTS_DIR, listFilesInDir } from '../statements/statement-files-catalog.js';
import { getReportingManifest } from './reporting-manifest.js';
import { resolveReportingPeriod } from './period.js';

export interface ReadinessDeps {
  monthsOnDisk?: (account: string, docType: 'pdf' | 'csv') => Set<string>;
  invoicesForEntity?: (entityId: EntityId) => readonly Invoice[];
  invoicePdfExists?: (invoice: Invoice) => boolean;
  hasTransactionsInMonth?: (account: string, monthKey: string) => boolean;
  now?: Date;
}

export interface ComputeReadinessArgs {
  entityId: EntityId;
  regime: ReportingRegime;
  periodLabel: string;
}

function defaultMonthsOnDisk(account: string, docType: 'pdf' | 'csv'): Set<string> {
  const dir = path.join(STATEMENTS_DIR, account, docType);
  return new Set(listFilesInDir(dir).map(f => f.displayDate));
}

function defaultInvoicePdfExists(invoice: Invoice): boolean {
  return isInvoiceStoredPdfAvailable(invoice);
}

function defaultHasTransactionsInMonth(account: string, monthKey: string): boolean {
  return (
    getTransactions({
      account,
      year: monthKey.slice(0, 4),
      month: monthKey.slice(5, 7),
      includeTransfers: true,
    }).length > 0
  );
}

export function computeReportingReadiness(
  args: ComputeReadinessArgs,
  deps: ReadinessDeps = {},
): ReportingReadinessResponse {
  const period = resolveReportingPeriod(args.regime, args.periodLabel);
  const manifest = getReportingManifest(args.entityId, args.regime);
  const monthsOnDisk = deps.monthsOnDisk ?? defaultMonthsOnDisk;
  const invoicesForEntity = deps.invoicesForEntity ?? listInvoicesByIssuingEntityId;
  const invoicePdfExists = deps.invoicePdfExists ?? defaultInvoicePdfExists;
  const hasTransactionsInMonth = deps.hasTransactionsInMonth ?? defaultHasTransactionsInMonth;
  const now = deps.now ?? new Date();

  const present: ReportingReadinessItem[] = [];
  const missing: ReportingReadinessItem[] = [];

  for (const account of manifest.accounts) {
    const docTypes = manifest.docTypesByAccount.get(account) ?? ['pdf', 'csv'];
    const csvOnly = !docTypes.includes('pdf');
    const accountConfig = getAccountConfig(account);
    const accountLabel = accountConfig.label;
    const openedFrom = accountConfig.bankOpenedDate?.slice(0, 7) ?? null;

    for (const monthKey of period.monthKeys) {
      if (openedFrom !== null && monthKey < openedFrom) {
        continue;
      }
      if (csvOnly && !hasTransactionsInMonth(account, monthKey)) {
        continue;
      }
      for (const docType of docTypes) {
        const item: ReportingReadinessItem = {
          account,
          accountLabel,
          monthKey,
          docType,
        };
        if (monthsOnDisk(account, docType).has(monthKey)) {
          present.push(item);
        } else {
          missing.push(item);
        }
      }
    }
  }

  let requiredCount = 0;
  let presentCount = 0;
  const missingInvoiceNumbers: string[] = [];

  if (manifest.requiresInvoices) {
    const inPeriod = invoicesForEntity(args.entityId).filter(
      inv =>
        inv.invoice_date >= period.startDate && inv.invoice_date <= period.endDate,
    );
    requiredCount = inPeriod.length;
    for (const inv of inPeriod) {
      if (invoicePdfExists(inv)) {
        presentCount += 1;
      } else {
        missingInvoiceNumbers.push(inv.invoice_number);
      }
    }
  }

  const ready = missing.length === 0 && missingInvoiceNumbers.length === 0;

  const accountsOverview = manifest.accounts.map(account => {
    const missingForAccount = missing.filter(m => m.account === account);
    return {
      account,
      accountLabel: getAccountConfig(account).label,
      ready: missingForAccount.length === 0,
      missingDocCount: missingForAccount.length,
    };
  });

  const response = {
    entityId: args.entityId,
    regime: args.regime,
    periodLabel: period.label,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    ready,
    accountsOverview,
    present,
    missing,
    invoices: {
      requiredCount,
      presentCount,
      missingInvoiceNumbers,
    },
    generatedAt: now.toISOString(),
  };

  return ReportingReadinessResponseSchema.parse(response);
}

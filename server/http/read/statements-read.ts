import path from 'node:path';
import { ACCOUNTS } from '../../types.js';
import type { CheckQuarterResponse, ReportingReadinessItem } from '../../../shared/api-contracts.js';
import {
  StatementsResponseSchema,
  StatementYearsResponseSchema,
  AccountStatementResponseSchema,
  StatementInvoiceUploadsListResponseSchema,
} from '../../../shared/api-contracts.js';
import { computeReportingReadiness } from '../../domain/reporting/index.js';
import {
  STATEMENTS_DIR,
  listFilesInDir,
  invoiceUploadFilesList,
  statementYearsAscending,
  statementsGroupedByAccount,
  type StatementsListQueryInput,
} from '../../domain/statements/statement-files-catalog.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

function missingReadinessItemToCheckQuarterString(item: ReportingReadinessItem): string {
  const [yearStr, monthStr] = item.monthKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const monthName = new Date(year, month - 1).toLocaleString('en-GB', { month: 'long' });
  return `${item.accountLabel}: No ${item.docType.toUpperCase()} for ${monthName} ${year}`;
}

function ledgerAccount(account: string): account is typeof ACCOUNTS[number] {
  return (ACCOUNTS as readonly string[]).includes(account);
}

/** GET /api/statements/years */
export function readStatementYears(): JsonReadResult {
  const years = statementYearsAscending(ACCOUNTS);
  return jsonReadOk(StatementYearsResponseSchema.parse(years));
}

interface StatementsIndexedQueryRaw {
  search?: unknown;
  year?: unknown;
  month?: unknown;
  quarter?: unknown;
}

/** GET /api/statements parity (indexed list). */
export function readStatementsIndexFromQuery(raw: StatementsIndexedQueryRaw): JsonReadResult {
  const parsed: StatementsListQueryInput = {
    search: typeof raw.search === 'string' ? raw.search : undefined,
    year: typeof raw.year === 'string' ? raw.year : undefined,
    month:
      typeof raw.month === 'string' ? raw.month : raw.month !== undefined ? String(raw.month) : undefined,
    quarter: typeof raw.quarter === 'string' ? raw.quarter : undefined,
  };
  const grouped = statementsGroupedByAccount(ACCOUNTS, parsed);
  return jsonReadOk(StatementsResponseSchema.parse(grouped));
}

/** GET /api/statements/check-quarter parity. */
export function readStatementsQuarterCheck(quarterUnknown: unknown): JsonReadResult {
  if (typeof quarterUnknown !== 'string' || quarterUnknown.trim() === '') {
    return jsonReadFail(400, { error: 'Quarter parameter required' });
  }
  const quarter = quarterUnknown.trim();

  const readiness = computeReportingReadiness({
    entityId: 'autonize-it-ltd',
    regime: 'vat',
    periodLabel: quarter,
  });

  const missingFiles = readiness.missing.map(missingReadinessItemToCheckQuarterString);

  const body: CheckQuarterResponse = { missingFiles };
  return jsonReadOk(body);
}

/** GET /api/statements/accounts parity. */
export function readStatementLedgerAccounts(): JsonReadResult {
  return jsonReadOk(ACCOUNTS);
}

/** GET /api/statements/:account parity. */
export function readStatementsForLedgerAccount(accountParam: unknown): JsonReadResult {
  if (typeof accountParam !== 'string' || !ledgerAccount(accountParam)) {
    return jsonReadFail(404, { error: 'Account not found' });
  }
  const accountDir = path.join(STATEMENTS_DIR, accountParam);
  const pdfDir = path.join(accountDir, 'pdf');
  const csvDir = path.join(accountDir, 'csv');
  const result = AccountStatementResponseSchema.parse({
    pdf: listFilesInDir(pdfDir),
    csv: listFilesInDir(csvDir),
  });
  return jsonReadOk(result);
}

/** GET /api/statements/invoices/list parity. */
export function readStatementBulkInvoiceUploads(): JsonReadResult {
  const files = invoiceUploadFilesList();
  return jsonReadOk(StatementInvoiceUploadsListResponseSchema.parse(files));
}

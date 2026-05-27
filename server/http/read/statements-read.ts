import path from 'node:path';
import { ACCOUNTS } from '../../types.js';
import type { CheckQuarterResponse } from '../../../shared/api-contracts.js';
import {
  StatementsResponseSchema,
  StatementYearsResponseSchema,
  AccountStatementResponseSchema,
  StatementInvoiceUploadsListResponseSchema,
} from '../../../shared/api-contracts.js';
import { getAccountConfig, businessAccounts } from '../../domain/accounts/index.js';
import {
  STATEMENTS_DIR,
  listFilesInDir,
  invoiceUploadFilesList,
  statementYearsAscending,
  statementsGroupedByAccount,
  getQuarterMonths,
  type StatementsListQueryInput,
} from '../../domain/statements/statement-files-catalog.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

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

  const businessAccts = businessAccounts();
  const expectedMonths = getQuarterMonths(quarter);
  const missingFiles: string[] = [];

  for (const account of businessAccts) {
    const accountConfig = getAccountConfig(account);
    const accountDir = path.join(STATEMENTS_DIR, account);
    const pdfDir = path.join(accountDir, 'pdf');
    const csvDir = path.join(accountDir, 'csv');

    const pdfs = listFilesInDir(pdfDir);
    const csvs = listFilesInDir(csvDir);

    for (const { year, month } of expectedMonths) {
      const monthStr = month.toString().padStart(2, '0');
      const expectedDate = `${year}-${monthStr}`;

      const hasPdf = pdfs.some(f => f.displayDate === expectedDate);
      if (!hasPdf) {
        const monthName = new Date(year, month - 1).toLocaleString('en-GB', { month: 'long' });
        missingFiles.push(`${accountConfig.label}: No PDF for ${monthName} ${year}`);
      }

      const hasCsv = csvs.some(f => f.displayDate === expectedDate);
      if (!hasCsv) {
        const monthName = new Date(year, month - 1).toLocaleString('en-GB', { month: 'long' });
        missingFiles.push(`${accountConfig.label}: No CSV for ${monthName} ${year}`);
      }
    }
  }

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

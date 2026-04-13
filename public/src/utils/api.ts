/**
 * API utility functions with typed fetch wrappers
 */

import {
  validateResponse,
  DashboardSummaryResponseSchema,
  AccountConfigsResponseSchema,
  TransactionsResponseSchema,
  AccountBalanceResponseSchema,
  VATPaymentsResponseSchema,
  StatementsResponseSchema,
  StatementYearsResponseSchema,
  CheckQuarterResponseSchema,
  CategoriesResponseSchema,
  ExpensesSheetResponseSchema,
  RecurringExpensesResponseSchema,
  type DashboardSummaryResponse,
  type AccountConfigsResponse,
  type TransactionsResponse,
  type AccountBalanceResponse,
  type VATPaymentsResponse,
  type StatementsResponse,
  type StatementYearsResponse,
  type CheckQuarterResponse,
  type CategoriesResponse,
  type ExpensesSheetResponse,
  type RecurringExpensesResponse,
} from '../../../shared/api-contracts.js';

/**
 * Fetch account configuration from backend
 */
export async function fetchAccountConfig(): Promise<AccountConfigsResponse> {
  const response = await fetch('/api/dashboard/accounts');
  return validateResponse(response, AccountConfigsResponseSchema);
}

/**
 * Fetch dashboard summary with optional filters
 */
export async function fetchDashboard(params?: {
  financialYear?: string;
  account?: string;
}): Promise<DashboardSummaryResponse> {
  const query = new URLSearchParams();
  if (params?.financialYear) query.set('financialYear', params.financialYear);
  if (params?.account) query.set('account', params.account);
  
  const url = `/api/dashboard/summary?${query}`;
  console.log('[API] Fetching dashboard:', url);
  const response = await fetch(url);
  return validateResponse(response, DashboardSummaryResponseSchema);
}

/**
 * Fetch account balance
 */
export async function fetchAccountBalance(account: string): Promise<AccountBalanceResponse> {
  const response = await fetch(`/api/dashboard/balance/${account}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  return validateResponse(response, AccountBalanceResponseSchema);
}

/**
 * Fetch transactions with filters
 */
export async function fetchTransactions(params: {
  year?: string;
  month?: string;
  account?: string;
  type?: string;
  category?: string;
  financialYear?: string;
  quarter?: string;
  search?: string;
}): Promise<TransactionsResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  
  const response = await fetch(`/api/dashboard/transactions?${query}`);
  return validateResponse(response, TransactionsResponseSchema);
}

/**
 * Fetch VAT payments
 */
export async function fetchVATPayments(params?: {
  account?: string;
}): Promise<VATPaymentsResponse> {
  const query = new URLSearchParams();
  if (params?.account) query.set('account', params.account);
  
  const response = await fetch(`/api/tax/vat-payments?${query}`);
  return validateResponse(response, VATPaymentsResponseSchema);
}

/**
 * Fetch statements with filters
 */
export async function fetchStatements(params?: {
  search?: string;
  year?: string;
  month?: string;
  quarter?: string;
}): Promise<StatementsResponse> {
  const query = new URLSearchParams();
  if (params?.search) query.set('search', params.search);
  if (params?.year) query.set('year', params.year);
  if (params?.month) query.set('month', params.month);
  if (params?.quarter) query.set('quarter', params.quarter);
  
  const response = await fetch(`/api/statements?${query}`);
  return validateResponse(response, StatementsResponseSchema);
}

/**
 * Fetch available statement years
 */
export async function fetchStatementYears(): Promise<StatementYearsResponse> {
  const response = await fetch('/api/statements/years');
  return validateResponse(response, StatementYearsResponseSchema);
}

/**
 * Check for missing files in a quarter
 */
export async function checkQuarterFiles(quarter: string): Promise<CheckQuarterResponse> {
  const response = await fetch(`/api/statements/check-quarter?quarter=${quarter}`);
  return validateResponse(response, CheckQuarterResponseSchema);
}

/**
 * Fetch spending category breakdown for an account
 */
export async function fetchCategories(params: {
  account: string;
  financialYear?: string;
}): Promise<CategoriesResponse> {
  const query = new URLSearchParams();
  query.set('account', params.account);
  if (params.financialYear) query.set('financialYear', params.financialYear);

  const response = await fetch(`/api/dashboard/categories?${query}`);
  return validateResponse(response, CategoriesResponseSchema);
}

/**
 * Fetch budget overview (household-level, all accounts combined)
 */
export async function fetchBudgetOverview(): Promise<ExpensesSheetResponse> {
  const response = await fetch('/api/budget/overview');
  return validateResponse(response, ExpensesSheetResponseSchema);
}

/**
 * Fetch recurring expenses for a single account
 */
export async function fetchRecurringExpenses(params: {
  account: string;
  financialYear?: string;
}): Promise<RecurringExpensesResponse> {
  const query = new URLSearchParams();
  query.set('account', params.account);
  if (params.financialYear) query.set('financialYear', params.financialYear);

  const response = await fetch(`/api/budget/recurring?${query}`);
  return validateResponse(response, RecurringExpensesResponseSchema);
}

/**
 * Download all files for accountant (triggers browser download)
 */
export function downloadForAccountant(quarter: string): void {
  window.location.href = `/api/statements/download-for-accountant?quarter=${quarter}`;
}

/**
 * Download selected files (returns blob for download)
 */
export async function downloadSelectedFiles(files: Array<{
  account: string;
  type: string;
  filename: string;
}>): Promise<Blob> {
  const response = await fetch('/api/statements/download-selected', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files })
  });
  
  if (!response.ok) throw new Error('Failed to download selected files');
  return response.blob();
}

/**
 * Upload files via FormData
 */
export async function uploadFiles(
  url: string,
  formData: FormData,
  onProgress?: (percent: number) => void
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          onProgress(percentComplete);
        }
      });
    }
    
    xhr.addEventListener('load', () => {
      // Resolve for 2xx and 409 (duplicate detection) so the caller can inspect the body
      resolve(new Response(xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText
      }));
    });
    
    xhr.addEventListener('error', () => reject(new Error('Upload failed')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));
    
    xhr.open('POST', url);
    xhr.send(formData);
  });
}

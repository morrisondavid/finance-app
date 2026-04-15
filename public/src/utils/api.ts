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
  SimulationExclusionsResponseSchema,
  AdHocExpensesResponseSchema,
  AdHocMerchantSeriesResponseSchema,
  RecurringExpensesResponseSchema,
  BudgetsListResponseSchema,
  BudgetUpsertBodySchema,
  BudgetRowSchema,
  BudgetCategoryNamesResponseSchema,
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
  type SimulationExclusionsResponse,
  type AdHocExpensesResponse,
  type AdHocMerchantSeriesResponse,
  type RecurringExpensesResponse,
  type BudgetsListResponse,
  type BudgetUpsertBody,
  type BudgetRow,
  type BudgetCategoryNamesResponse,
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
  /** Same matching rules as budget nudge merchant cards (pipeline display or drill SQL). */
  merchantModalLabel?: string;
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
 * Fetch the Fixed Expenses sheet: fixed recurring monthly/annual items across all accounts (`GET /api/expenses/overview`).
 */
export async function fetchExpensesSheetOverview(): Promise<ExpensesSheetResponse> {
  const response = await fetch('/api/expenses/overview');
  return validateResponse(response, ExpensesSheetResponseSchema);
}

/** Replace persisted Fixed Expenses simulation excludes (`PUT /api/expenses/simulation-exclusions`). */
export async function putSimulationExclusions(lineKeys: readonly string[]): Promise<SimulationExclusionsResponse> {
  const response = await fetch('/api/expenses/simulation-exclusions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineKeys: [...lineKeys] } satisfies { lineKeys: string[] }),
  });
  return validateResponse(response, SimulationExclusionsResponseSchema);
}

/**
 * Ad hoc expense groups for one account, scoped by financial year (or all time) with the same recurring logic as `/recurring` (`GET /api/expenses/ad-hoc`).
 */
export async function fetchAdHocExpenses(params: {
  account: string;
  financialYear?: string;
  min: number;
  limit: number;
}): Promise<AdHocExpensesResponse> {
  const query = new URLSearchParams();
  query.set('account', params.account);
  if (params.financialYear) query.set('financialYear', params.financialYear);
  query.set('min', String(params.min));
  query.set('limit', String(params.limit));
  const response = await fetch(`/api/expenses/ad-hoc?${query}`);
  return validateResponse(response, AdHocExpensesResponseSchema);
}

/**
 * Monthly spend series for one ad-hoc bucket (`GET /api/expenses/ad-hoc/series`).
 */
export async function fetchAdHocMerchantSeries(params: {
  account: string;
  financialYear?: string;
  bucketKey: string;
}): Promise<AdHocMerchantSeriesResponse> {
  const query = new URLSearchParams();
  query.set('account', params.account);
  query.set('bucketKey', params.bucketKey);
  if (params.financialYear) query.set('financialYear', params.financialYear);
  const response = await fetch(`/api/expenses/ad-hoc/series?${query}`);
  return validateResponse(response, AdHocMerchantSeriesResponseSchema);
}

/**
 * Dashboard Fixed Expenses widget: recurring line items for one account (`GET /api/expenses/recurring`).
 */
export async function fetchRecurringExpenses(params: {
  account: string;
  financialYear?: string;
}): Promise<RecurringExpensesResponse> {
  const query = new URLSearchParams();
  query.set('account', params.account);
  if (params.financialYear) query.set('financialYear', params.financialYear);

  const response = await fetch(`/api/expenses/recurring?${query}`);
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

export async function fetchBudgetCategoryNames(): Promise<BudgetCategoryNamesResponse> {
  const response = await fetch('/api/budgets/category-names');
  return validateResponse(response, BudgetCategoryNamesResponseSchema);
}

export async function fetchBudgetsList(params: { account: string }): Promise<BudgetsListResponse> {
  const query = new URLSearchParams();
  query.set('account', params.account);
  const response = await fetch(`/api/budgets?${query}`);
  return validateResponse(response, BudgetsListResponseSchema);
}

export async function createBudget(body: BudgetUpsertBody): Promise<BudgetRow> {
  const parsed = BudgetUpsertBodySchema.parse(body);
  const response = await fetch('/api/budgets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed),
  });
  return validateResponse(response, BudgetRowSchema);
}

export async function deleteBudget(id: number): Promise<void> {
  const response = await fetch(`/api/budgets/${id}`, { method: 'DELETE' });
  if (response.status === 204) return;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Delete failed (${response.status})`);
  }
}

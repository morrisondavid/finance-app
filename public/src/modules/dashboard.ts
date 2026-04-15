/**
 * Dashboard module — thin orchestrator that coordinates sub-modules.
 */

import type { DashboardSummary, AccountSummary } from '../types';
import { state, setState } from './state';
import { fetchDashboard, fetchTransactions } from '../utils/api';
import { formatCurrency } from '../utils/formatting';
import { loadRecurring } from './recurring.js';
import { loadAdHocExpenses } from './ad-hoc-expenses.js';
import { AccountNameSchema } from '../../../shared/api-contracts.js';

import { renderMonthlyChart, renderCategoryChart, renderMonthlyTable } from './dashboard-charts';
import { initTransactionsModal, initBalanceModal, initSummaryCardHandlers, initVatPaymentsHandler } from './dashboard-modals';
import { renderLiabilities } from './dashboard-vat';
import { renderBudgetDashboardPanel } from './dashboard-budgets';

// ─── Data loading ─────────────────────────────────────────────────────────────

export async function loadDashboard(): Promise<void> {
  try {
    const data = await fetchDashboard({
      account: state.selectedAccount,
      financialYear: state.selectedFinancialYear || undefined
    });

    setState('summaryData', data);

    if (data.selectedFinancialYear) {
      setState('selectedFinancialYear', data.selectedFinancialYear);
    }

    populateFinancialYearFilter(data.financialYears);
    updateAccountIndicators(data.byAccount as Record<string, AccountSummary>);
    setActiveAccountButtons(state.selectedAccount);
    renderSummaryCards(data);
    renderMonthlyChart(data.monthly);
    renderMonthlyTable(data.monthly);
    renderCategoryChart();
    loadRecentTransactions();
    loadRecurring();
    renderBudgetDashboardPanel(data);
  } catch (error) {
    console.error('[Dashboard] Error loading dashboard:', error);
    const container = document.getElementById('monthly-table');
    if (container) {
      container.innerHTML = '<p class="error">Failed to load dashboard data. Please try refreshing.</p>';
    }
  }
}

// ─── Financial year filter ────────────────────────────────────────────────────

const FY_FILTER_SELECTORS = '#fy-filter, #ad-hoc-fy-filter, #budget-fy-filter';

function populateFinancialYearFilter(financialYears: string[]): void {
  const selects = document.querySelectorAll<HTMLSelectElement>(FY_FILTER_SELECTORS);
  if (selects.length === 0 || !financialYears || financialYears.length === 0) return;

  const currentValue = selects[0].value;

  const optionHtml = '<option value="">All Time</option>' +
    financialYears.map(year => `<option value="${year}">${year}</option>`).join('');

  selects.forEach(sel => {
    sel.innerHTML = optionHtml;
  });

  let nextValue: string;
  if (currentValue && financialYears.includes(currentValue)) {
    nextValue = currentValue;
  } else if (state.selectedFinancialYear && financialYears.includes(state.selectedFinancialYear)) {
    nextValue = state.selectedFinancialYear;
  } else {
    nextValue = financialYears[0];
    setState('selectedFinancialYear', financialYears[0]);
  }

  selects.forEach(sel => {
    sel.value = nextValue;
  });
}

function initFinancialYearFilter(): void {
  document.querySelectorAll<HTMLSelectElement>(FY_FILTER_SELECTORS).forEach(sel => {
    sel.addEventListener('change', () => {
      const val = sel.value;
      setState('selectedFinancialYear', val);
      document.querySelectorAll<HTMLSelectElement>(FY_FILTER_SELECTORS).forEach(s => {
        if (s !== sel) s.value = val;
      });
      void loadDashboard();

      const adHocSection = document.getElementById('ad-hoc-expenses');
      if (adHocSection?.classList.contains('active')) {
        void loadAdHocExpenses();
      }

      const budgetSection = document.getElementById('budget');
      if (budgetSection?.classList.contains('active')) {
        void import('./budget-sheet.js').then(m => m.loadBudgetSheet());
      }
    });
  });
}

// ─── Account selector ─────────────────────────────────────────────────────────

function setActiveAccountButtons(account: string): void {
  document.querySelectorAll<HTMLElement>('.account-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.account === account);
  });
}

function initAccountSelector(): void {
  const accountBtns = document.querySelectorAll<HTMLElement>('.account-btn');

  accountBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const account = btn.dataset.account;
      if (!account) return;
      const parsed = AccountNameSchema.safeParse(account);
      if (!parsed.success) return;

      setActiveAccountButtons(account);
      setState('selectedAccount', parsed.data);
      void loadDashboard();

      const adHocSection = document.getElementById('ad-hoc-expenses');
      if (adHocSection?.classList.contains('active')) {
        void loadAdHocExpenses();
      }

      const budgetSection = document.getElementById('budget');
      if (budgetSection?.classList.contains('active')) {
        void import('./budget-sheet.js').then(m => m.loadBudgetSheet());
      }
    });
  });
}

function updateAccountIndicators(accountData: Record<string, AccountSummary>): void {
  const accountBtns = document.querySelectorAll<HTMLElement>('.account-btn');

  accountBtns.forEach(btn => {
    const account = btn.dataset.account;
    if (!account) return;

    const data = accountData[account];

    if (data && data.transactionCount > 0) {
      btn.classList.add('has-data');
    } else {
      btn.classList.remove('has-data');
    }

    const latestEl = btn.querySelector('.account-btn-latest');
    if (latestEl) {
      if (data?.newestTransaction) {
        const date = new Date(data.newestTransaction);
        latestEl.textContent = `Latest: ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      } else {
        latestEl.textContent = 'No transactions';
      }
    }
  });
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function renderSummaryCards(data: DashboardSummary): void {
  const totalIncomeEl = document.getElementById('total-income');
  const totalExpensesEl = document.getElementById('total-expenses');
  const netEl = document.getElementById('net-position');

  const passThrough = data.totals.passThroughIncome ?? 0;
  const adjustedIncome = data.totals.income - passThrough;
  const adjustedNet = data.totals.net - passThrough;

  if (totalIncomeEl) totalIncomeEl.textContent = formatCurrency(adjustedIncome);
  if (totalExpensesEl) totalExpensesEl.textContent = formatCurrency(data.totals.expenses);
  if (netEl) {
    netEl.textContent = formatCurrency(adjustedNet);
    netEl.className = 'card-value ' + (adjustedNet >= 0 ? 'income' : 'expense');
  }

  const transferInfo = document.getElementById('transfer-info');
  if (transferInfo) {
    if (data.transferCount && data.transferCount > 0) {
      transferInfo.style.display = 'block';
      const transferAmountEl = document.getElementById('transfer-amount');
      const transferCountEl = document.getElementById('transfer-count');
      if (transferAmountEl) transferAmountEl.textContent = formatCurrency(data.totals.transfersIn || 0);
      if (transferCountEl) transferCountEl.textContent = data.transferCount.toString();
    } else {
      transferInfo.style.display = 'none';
    }
  }

  if (data.currentAccountBalance) {
    renderBalancePanel(data.currentAccountBalance);
  }

  if (data.taxLiabilities) {
    renderLiabilities(data.taxLiabilities, data.selectedFinancialYear || '');
  }
}

function renderBalancePanel(balance: DashboardSummary['currentAccountBalance']): void {
  if (!balance) return;

  const openingBalanceEl = document.getElementById('opening-balance');
  const openingDateEl = document.getElementById('opening-balance-date');

  if (openingBalanceEl) openingBalanceEl.textContent = formatCurrency(balance.openingBalance);
  if (openingDateEl) {
    if (balance.openingBalanceDate) {
      openingDateEl.textContent = `as of ${balance.openingBalanceDate}`;
    } else if (balance.openingBalance === 0) {
      openingDateEl.textContent = 'Not set - click to set';
    } else {
      openingDateEl.textContent = '';
    }
  }

  const transactionTotalEl = document.getElementById('transaction-total');
  const transactionRangeEl = document.getElementById('transaction-date-range');

  if (transactionTotalEl) {
    transactionTotalEl.textContent = formatCurrency(balance.transactionTotal);
    transactionTotalEl.className = 'balance-value ' + (balance.transactionTotal >= 0 ? '' : 'expense');
  }

  if (transactionRangeEl) {
    if (balance.oldestTransaction && balance.newestTransaction) {
      transactionRangeEl.textContent = `${balance.oldestTransaction} to ${balance.newestTransaction}`;
    } else if (balance.transactionCount === 0) {
      transactionRangeEl.textContent = 'No transactions';
    } else {
      transactionRangeEl.textContent = '';
    }
  }

  const currentBalanceEl = document.getElementById('current-balance');
  if (currentBalanceEl) currentBalanceEl.textContent = formatCurrency(balance.currentBalance);
}

// ─── Recent transactions ──────────────────────────────────────────────────────

async function loadRecentTransactions(): Promise<void> {
  const container = document.getElementById('recent-transactions');
  if (!container) return;

  try {
    const data = await fetchTransactions({ account: state.selectedAccount });

    if (!data || data.length === 0) {
      container.innerHTML = '<p class="empty-state">No transactions found for this account/period.</p>';
      return;
    }

    container.innerHTML = data.map(t => `
      <div class="transaction-item">
        <div class="transaction-info">
          <div class="transaction-desc">${t.description || 'No description'}</div>
          <div class="transaction-meta">${t.date}</div>
        </div>
        <div class="transaction-amount ${t.type}">
          ${t.type === 'income' ? '+' : ''}${formatCurrency(t.amount)}
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading transactions:', error);
    container.innerHTML = '<p class="error">Failed to load recent transactions.</p>';
  }
}

// ─── Module init ──────────────────────────────────────────────────────────────

export function initDashboard(): void {
  initFinancialYearFilter();
  initAccountSelector();
  initBalanceModal();
  initTransactionsModal();
  initVatPaymentsHandler();
  initSummaryCardHandlers();
  loadDashboard();
}

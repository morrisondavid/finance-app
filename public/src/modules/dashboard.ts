/**
 * Dashboard module — thin orchestrator that coordinates sub-modules.
 */

import type { DashboardSummary, AccountSummary } from '../types';
import { state, setState, getSelectedCurrency, getAccountConfig } from './state';
import { fetchDashboard, fetchTransactions, syncBankFeed, FeedSyncRequestError } from '../utils/api';
import { computeFeedSyncDateFromNewestTransaction } from '../../../shared/feed-sync-window.js';
import { formatCurrency } from '../utils/formatting';
import { escapeHtml, escapeAttribute } from '../utils/dom';
import { loadRecurring } from './recurring.js';
import { loadAdHocExpenses } from './ad-hoc-expenses.js';
import { AccountNameSchema, type FeedSyncResponse } from '../../../shared/api-contracts.js';

import { renderMonthlyChart, renderCategoryChart, renderMonthlyTable } from './dashboard-charts';
import {
  initTransactionsModal,
  initBalanceModal,
  initSummaryCardHandlers,
  initVatPaymentsHandler,
  initBudgetDashboardPanelInteractions,
  initYearlyBudgetDashboardPanelInteractions,
} from './dashboard-modals';
import { renderLiabilities } from './dashboard-vat';
import { renderBudgetDashboardPanel, renderYearlyBudgetDashboardPanel } from './dashboard-budgets';
import { renderBudgetNudgesPanel, initBudgetNudgeInteractions } from './dashboard-budget-nudges';
import { applyBalancePanelLabelsForAccountType } from './balance-panel-labels';

// ─── Data loading ─────────────────────────────────────────────────────────────

export async function loadDashboard(): Promise<void> {
  try {
    const data = await fetchDashboard({
      account: state.selectedAccount,
      financialYear: state.selectedFinancialYear || undefined,
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
    renderYearlyBudgetDashboardPanel(data);
    renderBudgetNudgesPanel(data);
    refreshFeedSyncControlState();
  } catch (error) {
    console.error('[Dashboard] Error loading dashboard:', error);
    const container = document.getElementById('monthly-table');
    if (container) {
      container.innerHTML = '<p class="error">Failed to load dashboard data. Please try refreshing.</p>';
    }
  }
}

// ─── Financial year filter ────────────────────────────────────────────────────

const FY_FILTER_SELECTORS = '#fy-filter, #ad-hoc-fy-filter';

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
    });
  });
}

// ─── Account selector ─────────────────────────────────────────────────────────

export function populateAccountSelectors(): void {
  const configs = Object.values(state.accountConfig);
  if (configs.length === 0) return;

  const defaultAccount = state.selectedAccount;
  const buttonsHtml = configs
    .map(c => {
      const active = c.name === defaultAccount ? ' active' : '';
      return `<button type="button" class="account-btn${active}" data-account="${escapeAttribute(c.name)}">
  <span class="account-btn-label">${escapeHtml(c.label)}</span>
  <span class="account-btn-latest"></span>
</button>`;
    })
    .join('\n        ');

  document.querySelectorAll<HTMLElement>('.account-selector').forEach(container => {
    container.innerHTML = buttonsHtml;
  });
}

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
        void import('./budget-sheet.js').then(m => m.loadBudgetSheet()).catch(err => console.error('[Budget] reload failed', err));
      }
    });
  });
}

const FEED_SYNC_DISABLED_HINT =
  'Greyed out: no Enable Banking account id (`aispFeed.enableBanking.accountId`) and no TrueLayer linked account (`aispFeed.trueLayer.dataAccountId`). Use Enable OAuth + CSV, or POST /api/feed/truelayer/start + gitignored TL tokens (`data/truelayer-tokens.local.json`), map `data/truelayer-account-links.csv` if multi-account — then reload.';

function feedSyncLikelyConfigured(cfg: ReturnType<typeof getAccountConfig>): boolean {
  const eb =
    typeof cfg?.aispFeed?.enableBanking?.accountId === 'string' &&
    cfg.aispFeed.enableBanking.accountId.trim() !== '';
  const tl =
    typeof cfg?.aispFeed?.trueLayer?.dataAccountId === 'string' &&
    cfg.aispFeed.trueLayer.dataAccountId.trim() !== '';
  return eb || tl;
}

function refreshFeedSyncControlState(): void {
  const btn = document.getElementById('feed-sync-btn') as HTMLButtonElement | null;
  const hintEl = document.getElementById('feed-sync-hint');
  const forceCb = document.getElementById('feed-sync-force');
  if (!btn) return;

  const cfg = getAccountConfig(state.selectedAccount);
  const linked = feedSyncLikelyConfigured(cfg);

  if (!linked) {
    btn.disabled = true;
    btn.title = FEED_SYNC_DISABLED_HINT;
    if (hintEl instanceof HTMLElement) {
      hintEl.textContent = FEED_SYNC_DISABLED_HINT;
      hintEl.hidden = false;
    }
    if (forceCb instanceof HTMLInputElement) {
      forceCb.disabled = true;
    }
  } else {
    btn.title = '';
    if (hintEl instanceof HTMLElement) {
      hintEl.textContent = '';
      hintEl.hidden = true;
    }
    if (forceCb instanceof HTMLInputElement) {
      forceCb.disabled = false;
    }
    if (!btn.classList.contains('feed-sync-btn-loading')) {
      btn.disabled = false;
    }
  }
}

function formatFeedSyncResult(r: FeedSyncResponse): string {
  if (r.skipped && r.reason === 'already_up_to_date') {
    return 'Already up to date — nothing fetched.';
  }
  if (r.skipped) {
    return `Skipped: ${r.reason ?? 'unknown'}.`;
  }
  const parts: string[] = [
    `Fetched ${String(r.rowsFetched)} row(s) for ${r.window.dateFrom} → ${r.window.dateTo}.`,
  ];
  parts.push(r.csvWritten ? 'CSV written.' : 'No new CSV written.');
  if (r.ingestOutcome !== undefined) {
    parts.push(`Ingest: ${r.ingestOutcome}.`);
  }
  if (r.partitionedFiles.length > 0) {
    parts.push(`Partitions: ${r.partitionedFiles.join(', ')}.`);
  }
  if (r.initDatabaseRan) {
    parts.push('Database rebuilt.');
  }
  return parts.join(' ');
}

async function runFeedSyncFromUi(
  btn: HTMLButtonElement,
  forceCb: HTMLInputElement,
  statusEl: HTMLElement,
): Promise<void> {
  const cfg = getAccountConfig(state.selectedAccount);
  if (!feedSyncLikelyConfigured(cfg)) return;

  statusEl.textContent = '';
  statusEl.classList.remove('feed-sync-status-error');
  btn.classList.add('feed-sync-btn-loading');
  btn.disabled = true;

  const summary = state.summaryData?.byAccount[state.selectedAccount];
  const dateFrom = computeFeedSyncDateFromNewestTransaction(
    summary?.newestTransaction ?? null,
  );

  try {
    const result = await syncBankFeed({
      account: state.selectedAccount,
      dateFrom,
      force: forceCb.checked ? true : undefined,
    });
    statusEl.textContent = formatFeedSyncResult(result);
    await loadDashboard();
  } catch (err) {
    statusEl.classList.add('feed-sync-status-error');
    if (err instanceof FeedSyncRequestError) {
      const codePart = err.code !== undefined ? `[${err.code}] ` : '';
      statusEl.textContent = `${codePart}${err.message}`;
    } else {
      statusEl.textContent = err instanceof Error ? err.message : 'Sync failed.';
    }
  } finally {
    btn.classList.remove('feed-sync-btn-loading');
    refreshFeedSyncControlState();
  }
}

function initFeedSyncControl(): void {
  const btn = document.getElementById('feed-sync-btn');
  const forceCb = document.getElementById('feed-sync-force');
  const statusEl = document.getElementById('feed-sync-status');
  if (!(btn instanceof HTMLButtonElement)) return;
  if (!(forceCb instanceof HTMLInputElement)) return;
  if (!(statusEl instanceof HTMLElement)) return;

  btn.addEventListener('click', () => {
    void runFeedSyncFromUi(btn, forceCb, statusEl);
  });
  refreshFeedSyncControlState();
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

  const cur = getSelectedCurrency();
  const passThrough = data.totals.passThroughIncome ?? 0;
  const adjustedIncome = data.totals.income - passThrough;
  const adjustedNet = data.totals.net - passThrough;

  if (totalIncomeEl) totalIncomeEl.textContent = formatCurrency(adjustedIncome, cur);
  if (totalExpensesEl) totalExpensesEl.textContent = formatCurrency(data.totals.expenses, cur);
  if (netEl) {
    netEl.textContent = formatCurrency(adjustedNet, cur);
    netEl.className = 'card-value ' + (adjustedNet >= 0 ? 'income' : 'expense');
  }

  const transferInfo = document.getElementById('transfer-info');
  if (transferInfo) {
    if (data.transferCount && data.transferCount > 0) {
      transferInfo.style.display = 'block';
      const transferAmountEl = document.getElementById('transfer-amount');
      const transferCountEl = document.getElementById('transfer-count');
      if (transferAmountEl) transferAmountEl.textContent = formatCurrency(data.totals.transfersIn || 0, cur);
      if (transferCountEl) transferCountEl.textContent = data.transferCount.toString();
    } else {
      transferInfo.style.display = 'none';
    }
  }

  if (data.currentAccountBalance) {
    renderBalancePanel(data.currentAccountBalance);
    applyBalancePanelLabelsForAccountType(getAccountConfig(state.selectedAccount));
  }

  if (data.taxLiabilities) {
    renderLiabilities(data.taxLiabilities, data.selectedFinancialYear || '');
  }
}

function renderBalancePanel(balance: DashboardSummary['currentAccountBalance']): void {
  if (!balance) return;

  const cur = getSelectedCurrency();
  const openingBalanceEl = document.getElementById('opening-balance');
  const openingDateEl = document.getElementById('opening-balance-date');

  if (openingBalanceEl) openingBalanceEl.textContent = formatCurrency(balance.openingBalance, cur);
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
    transactionTotalEl.textContent = formatCurrency(balance.transactionTotal, cur);
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
  if (currentBalanceEl) currentBalanceEl.textContent = formatCurrency(balance.currentBalance, cur);
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

    const cur = getSelectedCurrency();
    container.innerHTML = data.map(t => `
      <div class="transaction-item">
        <div class="transaction-info">
          <div class="transaction-desc">${escapeHtml(t.description || 'No description')}</div>
          <div class="transaction-meta">${escapeHtml(t.date)}</div>
        </div>
        <div class="transaction-amount ${t.type}">
          ${t.type === 'income' ? '+' : ''}${formatCurrency(t.amount, cur)}
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
  initFeedSyncControl();
  initBalanceModal();
  initTransactionsModal();
  initBudgetDashboardPanelInteractions();
  initYearlyBudgetDashboardPanelInteractions();
  initBudgetNudgeInteractions();
  initVatPaymentsHandler();
  initSummaryCardHandlers();
}

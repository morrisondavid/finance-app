/**
 * Dashboard modal handlers — transactions modal, category drill-down,
 * balance modal, VAT payments/liability modals, summary card handlers.
 */

import { state } from './state';
import { getAccountConfig } from './state';
import { fetchTransactions, fetchVATPayments } from '../utils/api';
import { formatCurrency } from '../utils/formatting';
import { loadDashboard } from './dashboard';

export function initTransactionsModal(): void {
  const modal = document.getElementById('transactions-modal');
  const closeBtn = document.getElementById('close-transactions-modal');

  if (!modal || !closeBtn) return;

  closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      modal.style.display = 'none';
    }
  });
}

export function initBalanceModal(): void {
  const editBtn = document.getElementById('edit-balance-btn');
  const modal = document.getElementById('balance-modal');
  const cancelBtn = document.getElementById('cancel-balance-btn');
  const saveBtn = document.getElementById('save-balance-btn');
  const balanceInput = document.getElementById('opening-balance-input') as HTMLInputElement;
  const dateInput = document.getElementById('opening-balance-date-input') as HTMLInputElement;

  if (!editBtn || !modal || !cancelBtn || !saveBtn || !balanceInput || !dateInput) return;

  editBtn.addEventListener('click', () => {
    if (state.summaryData?.currentAccountBalance) {
      const balance = state.summaryData.currentAccountBalance;
      balanceInput.value = balance.openingBalance?.toString() || '';
      dateInput.value = balance.openingBalanceDate || '';
    }
    modal.style.display = 'flex';
  });

  cancelBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

  saveBtn.addEventListener('click', async () => {
    const balance = parseFloat(balanceInput.value) || 0;
    const date = dateInput.value || undefined;

    try {
      const response = await fetch(`/api/dashboard/balance/${state.selectedAccount}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance, date })
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      modal.style.display = 'none';
      loadDashboard();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert('Error saving balance: ' + errorMessage);
    }
  });
}

function getModalElements() {
  const modal = document.getElementById('transactions-modal');
  const titleEl = document.getElementById('transactions-modal-title');
  const countEl = document.getElementById('transactions-modal-count');
  const totalEl = document.getElementById('transactions-modal-total');
  const listEl = document.getElementById('transactions-modal-list');
  if (!modal || !titleEl || !countEl || !totalEl || !listEl) return null;
  return { modal, titleEl, countEl, totalEl, listEl };
}

type RenderTransactionListOptions = {
  /** When set, header total matches income card: gross minus pass-through for the loaded FY. */
  passThroughExcluded?: number;
};

function renderTransactionList(
  transactions: Array<{ date: string; description: string; amount: number; type: string }>,
  type: string,
  listEl: HTMLElement,
  countEl: HTMLElement,
  totalEl: HTMLElement,
  emptyMessage = 'No transactions found.',
  options?: RenderTransactionListOptions,
): void {
  const grossTotal = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const passThrough = options?.passThroughExcluded ?? 0;
  const displayTotal =
    type === 'income' && passThrough > 0 ? Math.max(0, grossTotal - passThrough) : grossTotal;

  countEl.textContent = `${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`;
  totalEl.textContent = formatCurrency(displayTotal);
  totalEl.className = 'modal-total ' + type;

  if (transactions.length === 0) {
    listEl.innerHTML = `<p class="empty-state">${emptyMessage}</p>`;
  } else {
    listEl.innerHTML = transactions.map(t => `
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
  }
}

export async function showTransactionsModal(month: string, type: 'income' | 'expense'): Promise<void> {
  const els = getModalElements();
  if (!els) return;
  const { modal, titleEl, countEl, totalEl, listEl } = els;

  const [year, monthNum] = month.split('-');
  const monthName = new Date(parseInt(year), parseInt(monthNum) - 1).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric'
  });

  const typeLabel = type === 'income' ? 'Income' : 'Outgoings';
  titleEl.textContent = `${typeLabel} - ${monthName}`;
  titleEl.className = type;
  listEl.innerHTML = '<div class="loading">Loading transactions...</div>';
  modal.style.display = 'flex';

  try {
    const [yearStr, monthStr] = month.split('-');
    const data = await fetchTransactions({
      account: state.selectedAccount,
      year: yearStr,
      month: monthStr,
      type
    });
    renderTransactionList(data, type, listEl, countEl, totalEl);
  } catch (error) {
    console.error('Error loading transactions:', error);
    listEl.innerHTML = '<p class="error">Error loading transactions.</p>';
  }
}

/** Expenses in one calendar month for a budget category (selected account). */
export async function showBudgetMonthTransactionsModal(
  categoryName: string,
  monthKey: string,
  monthLabel: string,
): Promise<void> {
  const els = getModalElements();
  if (!els) return;
  const { modal, titleEl, countEl, totalEl, listEl } = els;

  const parts = monthKey.split('-');
  if (parts.length !== 2) return;
  const [yearStr, monthStr] = parts;

  titleEl.textContent = `${categoryName} — ${monthLabel}`;
  titleEl.className = 'expense';
  listEl.innerHTML = '<div class="loading">Loading transactions...</div>';
  modal.style.display = 'flex';

  try {
    const data = await fetchTransactions({
      account: state.selectedAccount,
      type: 'expense',
      category: categoryName,
      year: yearStr,
      month: monthStr,
    });
    const sorted = [...data].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const formatted = sorted.map(t => ({
      ...t,
      date: new Date(t.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    }));
    renderTransactionList(formatted, 'expense', listEl, countEl, totalEl, 'No expense transactions in this month for this category.');
  } catch (error) {
    console.error('Error loading budget month transactions:', error);
    listEl.innerHTML = '<p class="error">Error loading transactions.</p>';
  }
}

export async function showCategoryTransactionsModal(categoryName: string): Promise<void> {
  const els = getModalElements();
  if (!els) return;
  const { modal, titleEl, countEl, totalEl, listEl } = els;

  titleEl.textContent = categoryName;
  titleEl.className = 'expense';
  listEl.innerHTML = '<div class="loading">Loading transactions...</div>';
  modal.style.display = 'flex';

  try {
    const data = await fetchTransactions({
      account: state.selectedAccount,
      type: 'expense',
      category: categoryName,
      ...(state.selectedFinancialYear ? { financialYear: state.selectedFinancialYear } : {}),
    });
    const sorted = [...data].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    renderTransactionList(sorted, 'expense', listEl, countEl, totalEl);
  } catch (error) {
    console.error('Error loading category transactions:', error);
    listEl.innerHTML = '<p class="error">Error loading transactions.</p>';
  }
}

export function initSummaryCardHandlers(): void {
  document.getElementById('income-card')?.addEventListener('click', () => showAllTransactionsModal('income'));
  document.getElementById('outgoings-card')?.addEventListener('click', () => showAllTransactionsModal('expense'));
}

async function showAllTransactionsModal(type: 'income' | 'expense'): Promise<void> {
  const els = getModalElements();
  if (!els) return;
  const { modal, titleEl, countEl, totalEl, listEl } = els;

  const period = state.selectedFinancialYear || 'All Time';
  const typeLabel = type === 'income' ? 'Income' : 'Outgoings';
  titleEl.textContent = `${typeLabel} - ${period}`;
  titleEl.className = type;
  listEl.innerHTML = '<div class="loading">Loading transactions...</div>';
  modal.style.display = 'flex';

  try {
    const fy = state.selectedFinancialYear?.trim();
    const data = await fetchTransactions({
      account: state.selectedAccount,
      type,
      ...(fy ? { financialYear: fy } : {}),
    });
    const sorted = [...data].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const formatted = sorted.map(t => ({
      ...t,
      date: new Date(t.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    }));
    const passThrough =
      type === 'income' && fy ? (state.summaryData?.totals.passThroughIncome ?? 0) : 0;
    renderTransactionList(formatted, type, listEl, countEl, totalEl, 'No transactions found for the selected period.', {
      passThroughExcluded: passThrough > 0 ? passThrough : undefined,
    });
  } catch (error) {
    console.error(`Error loading ${type}:`, error);
    listEl.innerHTML = '<p class="error">Error loading transactions.</p>';
  }
}

export function initVatPaymentsHandler(): void {
  document.getElementById('vat-outstanding-card')?.addEventListener('click', () => showVatPaymentsModal());
  document.getElementById('vat-liability-card')?.addEventListener('click', () => showVatLiabilityModal());
}

function openBudgetMonthRowFromTable(tr: HTMLTableRowElement): void {
  const category = tr.dataset.budgetCategory;
  const monthKey = tr.dataset.budgetMonthKey;
  const monthLabel = tr.dataset.budgetMonthLabel;
  if (!category || !monthKey || !monthLabel) return;
  void showBudgetMonthTransactionsModal(category, monthKey, monthLabel);
}

/** One-time delegated clicks on budget month rows (re-render safe). */
export function initBudgetDashboardPanelInteractions(): void {
  const panel = document.getElementById('budget-dashboard-panel');
  if (!panel || panel.dataset.budgetDrillBound === '1') return;
  panel.dataset.budgetDrillBound = '1';

  panel.addEventListener('click', e => {
    const tr = (e.target as HTMLElement | null)?.closest?.('tr[data-budget-month]');
    if (!(tr instanceof HTMLTableRowElement) || !panel.contains(tr)) return;
    openBudgetMonthRowFromTable(tr);
  });

  panel.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target as HTMLElement | null;
    const tr = t?.closest?.('tr[data-budget-month]');
    if (!(tr instanceof HTMLTableRowElement) || !panel.contains(tr)) return;
    e.preventDefault();
    openBudgetMonthRowFromTable(tr);
  });
}

async function showVatPaymentsModal(): Promise<void> {
  const els = getModalElements();
  if (!els) return;
  const { modal, titleEl, countEl, totalEl, listEl } = els;

  const period = state.selectedFinancialYear || 'All Time';
  titleEl.textContent = `VAT Paid to HMRC - ${period}`;
  titleEl.className = 'income';
  listEl.innerHTML = '<div class="loading">Loading VAT payments...</div>';
  modal.style.display = 'flex';

  try {
    const data = await fetchVATPayments(state.selectedFinancialYear ? { account: state.selectedAccount } : undefined);
    const vatPayments = data.payments;
    const total = vatPayments.reduce((sum, t) => sum + Math.abs(t.amount), 0);

    countEl.textContent = `${vatPayments.length} payment${vatPayments.length !== 1 ? 's' : ''}`;
    totalEl.textContent = formatCurrency(total);
    totalEl.className = 'modal-total income';

    if (vatPayments.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No VAT payments found for the selected period.</p>';
    } else {
      listEl.innerHTML = vatPayments.map(t => {
        const date = new Date(t.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const accountLabel = getAccountConfig(t.account)?.label || t.account;
        return `
          <div class="transaction-item">
            <div class="transaction-info">
              <div class="transaction-desc">${t.description || 'HMRC VAT Payment'}</div>
              <div class="transaction-meta">${date} • ${accountLabel}</div>
            </div>
            <div class="transaction-amount income">${formatCurrency(Math.abs(t.amount))}</div>
          </div>
        `;
      }).join('');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error loading VAT payments:', error);
    listEl.innerHTML = `<p class="error">Error loading VAT payments: ${errorMessage}</p>`;
  }
}

async function showVatLiabilityModal(): Promise<void> {
  const els = getModalElements();
  if (!els) return;
  const { modal, titleEl, countEl, totalEl, listEl } = els;

  const period = state.selectedFinancialYear || 'All Time';
  titleEl.textContent = `Income (VAT Breakdown) - ${period}`;
  titleEl.className = 'income';
  listEl.innerHTML = '<div class="loading">Loading income transactions...</div>';
  modal.style.display = 'flex';

  try {
    const fy = state.selectedFinancialYear?.trim();
    const data = await fetchTransactions({
      account: state.selectedAccount,
      type: 'income',
      ...(fy ? { financialYear: fy } : {}),
    });
    const sorted = [...data].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const totalIncome = sorted.reduce((sum, t) => sum + t.amount, 0);
    const totalVat = totalIncome / 6;

    countEl.textContent = `${sorted.length} transaction${sorted.length !== 1 ? 's' : ''}`;
    totalEl.innerHTML = `${formatCurrency(totalIncome)} <span style="color: var(--color-text-muted); font-size: 0.875rem;">(VAT: ${formatCurrency(totalVat)})</span>`;
    totalEl.className = 'modal-total income';

    if (sorted.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No income found for the selected period.</p>';
    } else {
      listEl.innerHTML = sorted.map(t => {
        const date = new Date(t.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const vat = t.amount / 6;
        return `
          <div class="transaction-item">
            <div class="transaction-info">
              <div class="transaction-desc">${t.description || 'Income'}</div>
              <div class="transaction-meta">${date}</div>
            </div>
            <div class="transaction-amount income">
              ${formatCurrency(t.amount)} <span style="color: var(--color-text-muted); font-size: 0.75rem;">(VAT: ${formatCurrency(vat)})</span>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (error) {
    console.error('Error loading income:', error);
    listEl.innerHTML = '<p class="error">Error loading income transactions.</p>';
  }
}

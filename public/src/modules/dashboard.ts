/**
 * Dashboard module - financial overview with charts and tax liabilities
 */

import { Chart } from 'chart.js/auto';
import type { DashboardSummary, MonthlySummary } from '../types';
import { state, setState, getAccountConfig } from './state';
import { fetchDashboard, fetchTransactions, fetchVATPayments } from '../utils/api';
import { formatCurrency } from '../utils/formatting';

// Store monthly data for chart click handling
let currentMonthlyData: MonthlySummary[] = [];

/**
 * Load dashboard data
 */
export async function loadDashboard(): Promise<void> {
  try {
    console.log('[Dashboard] Loading with:', { account: state.selectedAccount, financialYear: state.selectedFinancialYear });
    const data = await fetchDashboard({
      account: state.selectedAccount,
      financialYear: state.selectedFinancialYear || undefined
    });
    console.log('[Dashboard] Data received:', data);
    
    setState('summaryData', data);
    
    // Sync the selected financial year with what the backend returned
    if (data.selectedFinancialYear) {
      setState('selectedFinancialYear', data.selectedFinancialYear);
    }
    
    // Populate financial year dropdown
    populateFinancialYearFilter(data.financialYears);
    
    // Update account selector indicators
    updateAccountIndicators(data.byAccount as Record<string, import('../types').AccountSummary>);
    
    renderSummaryCards(data);
    renderMonthlyChart(data.monthly);
    renderMonthlyTable(data.monthly);
    
    // Load transactions for the selected account
    loadRecentTransactions();
  } catch (error) {
    console.error('[Dashboard] Error loading dashboard:', error);
  }
}

/**
 * Populate financial year filter dropdown
 */
function populateFinancialYearFilter(financialYears: string[]): void {
  const financialYearFilter = document.getElementById('fy-filter') as HTMLSelectElement;
  if (!financialYearFilter || !financialYears || financialYears.length === 0) return;
  
  // Keep the current selection
  const currentValue = financialYearFilter.value;
  
  financialYearFilter.innerHTML = '<option value="">All Time</option>' +
    financialYears.map(year => `<option value="${year}">${year}</option>`).join('');
  
  // Restore selection if it exists, otherwise default to current (first) year
  if (currentValue && financialYears.includes(currentValue)) {
    financialYearFilter.value = currentValue;
  } else if (state.selectedFinancialYear && financialYears.includes(state.selectedFinancialYear)) {
    financialYearFilter.value = state.selectedFinancialYear;
  } else {
    // Default to current year (first in list)
    financialYearFilter.value = financialYears[0];
    setState('selectedFinancialYear', financialYears[0]);
  }
}

/**
 * Initialize financial year filter event listener
 */
function initFinancialYearFilter(): void {
  const financialYearFilter = document.getElementById('fy-filter') as HTMLSelectElement;
  if (!financialYearFilter) return;
  
  financialYearFilter.addEventListener('change', () => {
    console.log('[Dashboard] Financial year changed to:', financialYearFilter.value);
    setState('selectedFinancialYear', financialYearFilter.value);
    loadDashboard();
  });
}

/**
 * Initialize account selector buttons
 */
function initAccountSelector(): void {
  const accountBtns = document.querySelectorAll<HTMLElement>('.account-btn');
  
  accountBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      accountBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update selected account and reload
      const account = btn.dataset.account;
      if (account) {
        // Type assertion to satisfy AccountName constraint
        setState('selectedAccount', account as typeof state.selectedAccount);
        loadDashboard();
      }
    });
  });
}

/**
 * Update account indicator badges
 */
function updateAccountIndicators(accountData: Record<string, import('../types').AccountSummary>): void {
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

/**
 * Render summary cards (income, expenses, net position)
 */
function renderSummaryCards(data: DashboardSummary): void {
  console.log('[Dashboard] Rendering summary cards with totals:', data.totals);
  const totalIncomeEl = document.getElementById('total-income');
  const totalExpensesEl = document.getElementById('total-expenses');
  const netEl = document.getElementById('net-position');
  
  console.log('[Dashboard] Elements found:', { totalIncomeEl: !!totalIncomeEl, totalExpensesEl: !!totalExpensesEl, netEl: !!netEl });
  
  if (totalIncomeEl) {
    totalIncomeEl.textContent = formatCurrency(data.totals.income);
    console.log('[Dashboard] Updated income to:', totalIncomeEl.textContent);
  }
  if (totalExpensesEl) {
    totalExpensesEl.textContent = formatCurrency(data.totals.expenses);
    console.log('[Dashboard] Updated expenses to:', totalExpensesEl.textContent);
  }
  
  if (netEl) {
    netEl.textContent = formatCurrency(data.totals.net);
    netEl.className = 'card-value ' + (data.totals.net >= 0 ? 'income' : 'expense');
  }
  
  // Show transfer info if there are transfers
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
  
  // Render balance panel
  if (data.currentAccountBalance) {
    renderBalancePanel(data.currentAccountBalance);
  }
  
  // Render tax liabilities panel
  if (data.taxLiabilities) {
    renderLiabilities(data.taxLiabilities, data.selectedFinancialYear || '');
  }
}

/**
 * Render tax liabilities panel
 */
function renderLiabilities(tax: DashboardSummary['taxLiabilities'], financialYear: string): void {
  const liabilitiesPanel = document.getElementById('liabilities-panel');
  const accountConfig = getAccountConfig(state.selectedAccount);
  
  if (!liabilitiesPanel) return;
  
  // Only show tax liabilities for accounts configured to show them
  if (!accountConfig.showTaxLiabilities) {
    liabilitiesPanel.style.display = 'none';
    document.getElementById('fy-banner')?.classList.remove('visible');
    document.getElementById('fy-key-dates')?.classList.remove('visible');
    document.getElementById('vat-timeline')?.classList.remove('visible');
    return;
  }
  liabilitiesPanel.style.display = 'block';
  
  if (!tax) return;
  
  // Update period label
  const periodEl = document.getElementById('liabilities-period');
  if (periodEl) periodEl.textContent = financialYear || 'All Time';
  
  // Update FY banner and key dates
  const fyBannerEl = document.getElementById('fy-banner');
  const fyKeyDatesEl = document.getElementById('fy-key-dates');
  
  if (fyBannerEl) {
    if (financialYear) {
      const match = financialYear.match(/^(\d{4})[/-](\d{2})$/);
      if (match) {
        const startYear = parseInt(match[1], 10);
        const endYear = startYear + 1;
        const formatDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        
        const yearStart = new Date(startYear, 4, 1);
        const yearEnd = new Date(endYear, 3, 30);
        const filingDeadline = new Date(endYear, 9, 31);
        const paymentDeadline = new Date(endYear + 1, 1, 1);
        
        fyBannerEl.innerHTML = `<strong>Financial Year ${financialYear}</strong> &mdash; ${formatDate(yearStart)} to ${formatDate(yearEnd)}`;
        fyBannerEl.classList.add('visible');
        
        if (fyKeyDatesEl && accountConfig.showTaxLiabilities) {
          const startEl = document.getElementById('fy-start-date');
          const endEl = document.getElementById('fy-end-date');
          const filingEl = document.getElementById('fy-filing-date');
          const paymentEl = document.getElementById('fy-payment-date');
          
          if (startEl) startEl.textContent = formatDate(yearStart);
          if (endEl) endEl.textContent = formatDate(yearEnd);
          if (filingEl) filingEl.textContent = formatDate(filingDeadline);
          if (paymentEl) paymentEl.textContent = formatDate(paymentDeadline);
          
          fyKeyDatesEl.classList.add('visible');
        }
      }
    } else {
      fyBannerEl.classList.remove('visible');
      if (fyKeyDatesEl) fyKeyDatesEl.classList.remove('visible');
    }
  }
  
  if (fyKeyDatesEl && !accountConfig.showTaxLiabilities) {
    fyKeyDatesEl.classList.remove('visible');
  }
  
  const vatTimelineEl = document.getElementById('vat-timeline');
  if (vatTimelineEl) {
    if (accountConfig.showTaxLiabilities && financialYear) {
      renderVatTimeline(financialYear, tax);
      vatTimelineEl.classList.add('visible');
    } else {
      vatTimelineEl.classList.remove('visible');
    }
  }
  
  // VAT - Current Quarter
  const vatOutstandingEl = document.getElementById('vat-outstanding');
  const vatEstimatedEl = document.getElementById('vat-estimated');
  const vatPaidEl = document.getElementById('vat-paid');
  
  if (vatOutstandingEl) vatOutstandingEl.textContent = formatCurrency(tax.vatOwedThisQuarter || tax.vatOutstanding || 0);
  if (vatEstimatedEl) vatEstimatedEl.textContent = formatCurrency(tax.vatOnIncome || 0);
  if (vatPaidEl) vatPaidEl.textContent = formatCurrency(tax.vatPaidLast4Quarters || tax.vatPaid || 0);
  
  // VAT quarter label, period, and due date
  if (tax.vatQuarter) {
    const vatQuarterLabelEl = document.getElementById('vat-quarter-label');
    const vatPeriodEl = document.getElementById('vat-period');
    const vatDueDateEl = document.getElementById('vat-due-date');
    
    if (vatQuarterLabelEl) vatQuarterLabelEl.textContent = `(${tax.vatQuarter.label})`;
    
    // Format period dates (e.g., "1 Nov 2025 - 31 Jan 2026")
    const startDate = new Date(tax.vatQuarter.startDate);
    const endDate = new Date(tax.vatQuarter.endDate);
    const formatDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    
    if (vatPeriodEl) vatPeriodEl.textContent = `Period: ${formatDate(startDate)} - ${formatDate(endDate)}`;
    
    const dueDate = new Date(tax.vatQuarter.dueDate);
    if (vatDueDateEl) vatDueDateEl.textContent = `Due: ${formatDate(dueDate)}`;
  } else {
    const vatQuarterLabelEl = document.getElementById('vat-quarter-label');
    const vatPeriodEl = document.getElementById('vat-period');
    const vatDueDateEl = document.getElementById('vat-due-date');
    
    if (vatQuarterLabelEl) vatQuarterLabelEl.textContent = '';
    if (vatPeriodEl) vatPeriodEl.textContent = 'Period: -';
    if (vatDueDateEl) vatDueDateEl.textContent = `Due: ${getNextVatDueDate()}`;
  }
  
  // Corporation Tax
  const corpTaxEl = document.getElementById('corp-tax');
  const corpTaxNoteEl = document.getElementById('corp-tax-note');
  const corpTaxPeriodEl = document.getElementById('corp-tax-period');
  const corpTaxDueEl = document.getElementById('corp-tax-due');
  
  if (corpTaxEl) corpTaxEl.textContent = formatCurrency(tax.corporationTax);
  if (corpTaxNoteEl) {
    corpTaxNoteEl.textContent = `${tax.corporationTaxRate.toFixed(1)}% on ${formatCurrency(tax.taxableProfit)} profit`;
  }
  
  if (corpTaxPeriodEl || corpTaxDueEl) {
    if (financialYear) {
      const match = financialYear.match(/^(\d{4})[/-](\d{2})$/);
      if (match) {
        const startYear = parseInt(match[1], 10);
        const endYear = startYear + 1;
        const periodLabel = `May ${startYear} - Apr ${endYear}`;
        if (corpTaxPeriodEl) corpTaxPeriodEl.textContent = `(${periodLabel})`;
        
        const dueDate = new Date(endYear, 0, 1); // 9 months + 1 day after Apr 30 = 1 Feb next year
        dueDate.setMonth(dueDate.getMonth() + 1);
        const formattedDue = dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        if (corpTaxDueEl) corpTaxDueEl.textContent = `Due: ${formattedDue}`;
      }
    } else {
      if (corpTaxPeriodEl) corpTaxPeriodEl.textContent = '';
      if (corpTaxDueEl) corpTaxDueEl.textContent = '';
    }
  }
  
  // David's Personal Tax
  const davidTotal = tax.davidPayments?.total || 0;
  const davidSalary = tax.davidPayments?.salary || 0;
  const davidDividends = tax.davidPayments?.dividends || 0;
  
  const davidTaxEl = document.getElementById('david-tax');
  const davidTaxNoteEl = document.getElementById('david-tax-note');
  const davidSalaryPaidEl = document.getElementById('david-salary-paid');
  const davidDividendsPaidEl = document.getElementById('david-dividends-paid');
  const davidDividendTaxEl = document.getElementById('david-dividend-tax');
  const davidBreakdownEl = document.getElementById('david-breakdown');
  
  const davidTotalPaidEl = document.getElementById('david-total-paid');
  const davidAnnualSalaryEl = document.getElementById('david-annual-salary');
  
  if (davidTaxEl) davidTaxEl.textContent = formatCurrency(tax.davidTaxEstimate || 0);
  if (davidTaxNoteEl) davidTaxNoteEl.textContent = `on ${formatCurrency(davidTotal)} payments`;
  if (davidTotalPaidEl) davidTotalPaidEl.textContent = formatCurrency(davidTotal);
  const davidMonthlySalary = (tax.davidPayments?.annualSalary || 0) / 12;
  if (davidSalaryPaidEl) davidSalaryPaidEl.textContent = formatCurrency(davidSalary);
  const davidMonthlySalaryNoteEl = document.getElementById('david-monthly-salary-note');
  if (davidMonthlySalaryNoteEl) davidMonthlySalaryNoteEl.textContent = `(${formatCurrency(davidMonthlySalary)}/month)`;
  if (davidAnnualSalaryEl) davidAnnualSalaryEl.textContent = formatCurrency(tax.davidPayments?.annualSalary || 0);
  const davidMonthlySalaryEl = document.getElementById('david-monthly-salary');
  if (davidMonthlySalaryEl) davidMonthlySalaryEl.textContent = `(${formatCurrency(davidMonthlySalary)}/month)`;
  if (davidDividendsPaidEl) davidDividendsPaidEl.textContent = formatCurrency(davidDividends);
  if (davidDividendTaxEl) davidDividendTaxEl.textContent = formatCurrency(tax.davidTaxBreakdown?.dividendTax || 0);
  if (davidBreakdownEl) davidBreakdownEl.style.display = 'block';
  
  // Heena's Personal Tax
  const heenaTotal = tax.heenaPayments?.total || 0;
  const heenaSalary = tax.heenaPayments?.salary || 0;
  const heenaDividends = tax.heenaPayments?.dividends || 0;
  
  const heenaTaxEl = document.getElementById('heena-tax');
  const heenaTaxNoteEl = document.getElementById('heena-tax-note');
  const heenaSalaryPaidEl = document.getElementById('heena-salary-paid');
  const heenaDividendsPaidEl = document.getElementById('heena-dividends-paid');
  const heenaDividendTaxEl = document.getElementById('heena-dividend-tax');
  const heenaBreakdownEl = document.getElementById('heena-breakdown');
  
  const heenaTotalPaidEl = document.getElementById('heena-total-paid');
  const heenaAnnualSalaryEl = document.getElementById('heena-annual-salary');
  
  if (heenaTaxEl) heenaTaxEl.textContent = formatCurrency(tax.heenaTaxEstimate || 0);
  if (heenaTaxNoteEl) heenaTaxNoteEl.textContent = `on ${formatCurrency(heenaTotal)} payments`;
  if (heenaTotalPaidEl) heenaTotalPaidEl.textContent = formatCurrency(heenaTotal);
  const heenaMonthlySalary = (tax.heenaPayments?.annualSalary || 0) / 12;
  if (heenaSalaryPaidEl) heenaSalaryPaidEl.textContent = formatCurrency(heenaSalary);
  const heenaMonthlySalaryNoteEl = document.getElementById('heena-monthly-salary-note');
  if (heenaMonthlySalaryNoteEl) heenaMonthlySalaryNoteEl.textContent = `(${formatCurrency(heenaMonthlySalary)}/month)`;
  if (heenaAnnualSalaryEl) heenaAnnualSalaryEl.textContent = formatCurrency(tax.heenaPayments?.annualSalary || 0);
  const heenaMonthlySalaryEl = document.getElementById('heena-monthly-salary');
  if (heenaMonthlySalaryEl) heenaMonthlySalaryEl.textContent = `(${formatCurrency(heenaMonthlySalary)}/month)`;
  if (heenaDividendsPaidEl) heenaDividendsPaidEl.textContent = formatCurrency(heenaDividends);
  if (heenaDividendTaxEl) heenaDividendTaxEl.textContent = formatCurrency(tax.heenaTaxBreakdown?.dividendTax || 0);
  if (heenaBreakdownEl) heenaBreakdownEl.style.display = 'block';
}

/**
 * Render VAT timeline showing all 4 quarters with payment status
 */
async function renderVatTimeline(financialYear: string, tax: DashboardSummary['taxLiabilities']): Promise<void> {
  const gridEl = document.getElementById('vat-timeline-grid');
  if (!gridEl) return;
  
  const match = financialYear.match(/^(\d{4})[/-](\d{2})$/);
  if (!match) return;
  
  const startYear = parseInt(match[1], 10);
  const endYear = startYear + 1;
  const formatDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const now = new Date();
  
  // Build the 4 VAT quarters that fall within this financial year (May-Apr)
  // FY starts May, so quarters in order: Q3 May-Jul, Q4 Aug-Oct, Q1 Nov-Jan, Q2 Feb-Apr
  const quarters = [
    {
      label: 'Q3: May-Jul',
      start: new Date(startYear, 4, 1),
      end: new Date(startYear, 6, 31),
      due: new Date(startYear, 8, 7),
    },
    {
      label: 'Q4: Aug-Oct',
      start: new Date(startYear, 7, 1),
      end: new Date(startYear, 9, 31),
      due: new Date(startYear, 11, 7),
    },
    {
      label: 'Q1: Nov-Jan',
      start: new Date(startYear, 10, 1),
      end: new Date(endYear, 0, 31),
      due: new Date(endYear, 2, 7),
    },
    {
      label: 'Q2: Feb-Apr',
      start: new Date(endYear, 1, 1),
      end: new Date(endYear, 3, 30),
      due: new Date(endYear, 5, 7),
    },
  ];
  
  // Fetch VAT payments to match against quarters
  let payments: Array<{ date: string; amount: number }> = [];
  try {
    const data = await fetchVATPayments();
    payments = data.payments;
  } catch { /* proceed without payment data */ }
  
  // The "outstanding" quarter from tax data (due next, e.g. Q1 Nov-Jan due Mar 7)
  const outstandingQuarterLabel = tax?.vatQuarter?.label || '';
  const outstandingQuarterAmount = tax?.vatOwedThisQuarter || tax?.vatOutstanding || 0;
  
  // In-progress quarter estimate from backend
  const inProgressLabel = tax?.vatInProgressQuarter?.label || '';
  const inProgressEstimate = tax?.vatInProgressEstimate || 0;
  
  gridEl.innerHTML = quarters.map(q => {
    const periodStr = `${formatDate(q.start)} – ${formatDate(q.end)}`;
    const dueStr = `Due: ${formatDate(q.due)}`;
    const isPast = now > q.due;
    const isInProgress = inProgressLabel && q.label.includes(inProgressLabel.split(' ')[0]);
    
    // Find payment matching this quarter's due window
    const dueMonth = q.due.getMonth();
    const dueYear = q.due.getFullYear();
    const matchingPayment = payments.find(p => {
      const pDate = new Date(p.date);
      return pDate.getMonth() === dueMonth && pDate.getFullYear() === dueYear;
    });
    
    // Check if this is the outstanding quarter (due next but period ended)
    const isOutstanding = outstandingQuarterLabel && q.label.includes(outstandingQuarterLabel.split(' ')[0]);
    
    let statusClass = 'future';
    let amount = '—';
    let statusText = '';
    
    if (matchingPayment) {
      statusClass = 'paid';
      amount = formatCurrency(Math.abs(matchingPayment.amount));
      const paidDate = new Date(matchingPayment.date);
      statusText = `Paid ${formatDate(paidDate)}`;
    } else if (isOutstanding && !isInProgress) {
      statusClass = 'upcoming';
      amount = outstandingQuarterAmount > 0 ? `~${formatCurrency(outstandingQuarterAmount)}` : '—';
      statusText = 'Due — not yet paid';
    } else if (isInProgress) {
      statusClass = 'upcoming';
      amount = inProgressEstimate > 0 ? `~${formatCurrency(inProgressEstimate)}` : '—';
      statusText = 'In progress';
    } else if (isPast) {
      statusClass = 'paid';
      amount = '—';
      statusText = 'No payment found';
    }
    
    return `
      <div class="vat-quarter-item ${statusClass}">
        <span class="vat-quarter-label">${q.label}</span>
        <span class="vat-quarter-period">${periodStr}</span>
        <span class="vat-quarter-amount">${amount}</span>
        <span class="vat-quarter-due">${dueStr}</span>
        <span class="vat-quarter-status">${statusText}</span>
      </div>
    `;
  }).join('');
}

/**
 * Render balance panel
 */
function renderBalancePanel(balance: DashboardSummary['currentAccountBalance']): void {
  if (!balance) return;
  
  // Opening balance
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
  
  // Transaction total
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
  
  // Current balance
  const currentBalanceEl = document.getElementById('current-balance');
  if (currentBalanceEl) currentBalanceEl.textContent = formatCurrency(balance.currentBalance);
}

/**
 * Get next VAT due date based on current date (UK Stagger 2)
 */
function getNextVatDueDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  
  // VAT due dates for Stagger 2: 1 month and 7 days after quarter end
  const dueDates = [
    new Date(year, 2, 7),   // Mar 7 (for Nov-Jan)
    new Date(year, 5, 7),   // Jun 7 (for Feb-Apr)
    new Date(year, 8, 7),   // Sep 7 (for May-Jul)
    new Date(year, 11, 7),  // Dec 7 (for Aug-Oct)
    new Date(year + 1, 2, 7) // Mar 7 next year (for Nov-Jan)
  ];
  
  const nextDue = dueDates.find(d => d > now) || dueDates[0];
  
  return nextDue.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

/**
 * Initialize balance modal
 */
function initBalanceModal(): void {
  const editBtn = document.getElementById('edit-balance-btn');
  const modal = document.getElementById('balance-modal');
  const cancelBtn = document.getElementById('cancel-balance-btn');
  const saveBtn = document.getElementById('save-balance-btn');
  const balanceInput = document.getElementById('opening-balance-input') as HTMLInputElement;
  const dateInput = document.getElementById('opening-balance-date-input') as HTMLInputElement;
  
  if (!editBtn || !modal || !cancelBtn || !saveBtn || !balanceInput || !dateInput) return;
  
  // Open modal
  editBtn.addEventListener('click', () => {
    // Pre-fill with current values if available
    if (state.summaryData?.currentAccountBalance) {
      const balance = state.summaryData.currentAccountBalance;
      balanceInput.value = balance.openingBalance?.toString() || '';
      dateInput.value = balance.openingBalanceDate || '';
    }
    modal.style.display = 'flex';
  });
  
  // Close modal
  cancelBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });
  
  // Save balance
  saveBtn.addEventListener('click', async () => {
    const balance = parseFloat(balanceInput.value) || 0;
    const date = dateInput.value || undefined;
    
    try {
      // This endpoint expects POST with balance and date
      await fetch(`/api/dashboard/balance/${state.selectedAccount}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance, date })
      });
      
      modal.style.display = 'none';
      // Reload dashboard to get updated balance
      loadDashboard();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert('Error saving balance: ' + errorMessage);
    }
  });
}

/**
 * Initialize transactions modal
 */
function initTransactionsModal(): void {
  const modal = document.getElementById('transactions-modal');
  const closeBtn = document.getElementById('close-transactions-modal');
  
  if (!modal || !closeBtn) return;
  
  // Close on X button
  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });
  
  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      modal.style.display = 'none';
    }
  });
}

/**
 * Show transactions modal for a specific month
 */
async function showTransactionsModal(month: string, type: 'income' | 'expense'): Promise<void> {
  const modal = document.getElementById('transactions-modal');
  const titleEl = document.getElementById('transactions-modal-title');
  const countEl = document.getElementById('transactions-modal-count');
  const totalEl = document.getElementById('transactions-modal-total');
  const listEl = document.getElementById('transactions-modal-list');
  
  if (!modal || !titleEl || !countEl || !totalEl || !listEl) return;
  
  // Parse month for display
  const [year, monthNum] = month.split('-');
  const monthName = new Date(parseInt(year), parseInt(monthNum) - 1).toLocaleDateString('en-GB', { 
    month: 'long', 
    year: 'numeric' 
  });
  
  // Set title
  const typeLabel = type === 'income' ? 'Income' : 'Outgoings';
  titleEl.textContent = `${typeLabel} - ${monthName}`;
  titleEl.className = type;
  
  // Show loading state
  listEl.innerHTML = '<div class="loading">Loading transactions...</div>';
  modal.style.display = 'flex';
  
  try {
    // Fetch transactions for this month and type
    const data = await fetchTransactions({
      account: state.selectedAccount,
      month,
      type
    });
    
    const transactions = data;
    
    // Calculate total
    const total = transactions.reduce((sum: number, t) => sum + Math.abs(t.amount), 0);
    
    // Update summary
    countEl.textContent = `${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`;
    totalEl.textContent = formatCurrency(total);
    totalEl.className = 'modal-total ' + type;
    
    // Render transactions
    if (transactions.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No transactions found.</p>';
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
  } catch (error) {
    console.error('Error loading transactions:', error);
    listEl.innerHTML = '<p class="error">Error loading transactions.</p>';
  }
}

/**
 * Initialize VAT payments handler
 */
function initVatPaymentsHandler(): void {
  // VAT Outstanding card - shows payments already made
  const vatOutstandingCard = document.getElementById('vat-outstanding-card');
  if (vatOutstandingCard) {
    vatOutstandingCard.addEventListener('click', () => {
      showVatPaymentsModal();
    });
  }
  
  // VAT Liability card - shows income with VAT breakdown
  const vatLiabilityCard = document.getElementById('vat-liability-card');
  if (vatLiabilityCard) {
    vatLiabilityCard.addEventListener('click', () => {
      showVatLiabilityModal();
    });
  }
}

/**
 * Initialize summary card click handlers
 */
function initSummaryCardHandlers(): void {
  // Income card - shows all income for the period
  const incomeCard = document.getElementById('income-card');
  if (incomeCard) {
    incomeCard.addEventListener('click', () => {
      showAllTransactionsModal('income');
    });
  }
  
  // Outgoings card - shows all outgoings for the period
  const outgoingsCard = document.getElementById('outgoings-card');
  if (outgoingsCard) {
    outgoingsCard.addEventListener('click', () => {
      showAllTransactionsModal('expense');
    });
  }
}

/**
 * Show all transactions modal for a given type
 */
async function showAllTransactionsModal(type: 'income' | 'expense'): Promise<void> {
  const modal = document.getElementById('transactions-modal');
  const titleEl = document.getElementById('transactions-modal-title');
  const countEl = document.getElementById('transactions-modal-count');
  const totalEl = document.getElementById('transactions-modal-total');
  const listEl = document.getElementById('transactions-modal-list');
  
  if (!modal || !titleEl || !countEl || !totalEl || !listEl) return;
  
  // Set title
  const period = state.selectedFinancialYear || 'All Time';
  const typeLabel = type === 'income' ? 'Income' : 'Outgoings';
  titleEl.textContent = `${typeLabel} - ${period}`;
  titleEl.className = type;
  
  // Show loading state
  listEl.innerHTML = '<div class="loading">Loading transactions...</div>';
  modal.style.display = 'flex';
  
  try {
    // Fetch transactions for this type
    const data = await fetchTransactions({
      account: state.selectedAccount,
      type
    });
    
    const transactions = data;
    
    // Sort by date descending
    transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    // Calculate total
    const total = transactions.reduce((sum: number, t) => sum + Math.abs(t.amount), 0);
    
    // Update summary
    countEl.textContent = `${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`;
    totalEl.textContent = formatCurrency(total);
    totalEl.className = 'modal-total ' + type;
    
    // Render transactions
    if (transactions.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No transactions found for the selected period.</p>';
    } else {
      listEl.innerHTML = transactions.map(t => {
        const date = new Date(t.date).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });
        return `
          <div class="transaction-item">
            <div class="transaction-info">
              <div class="transaction-desc">${t.description || 'No description'}</div>
              <div class="transaction-meta">${date}</div>
            </div>
            <div class="transaction-amount ${type}">
              ${type === 'income' ? '+' : '-'}${formatCurrency(Math.abs(t.amount))}
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (error) {
    console.error(`Error loading ${type}:`, error);
    listEl.innerHTML = `<p class="error">Error loading transactions.</p>`;
  }
}

/**
 * Show VAT payments modal
 */
async function showVatPaymentsModal(): Promise<void> {
  const modal = document.getElementById('transactions-modal');
  const titleEl = document.getElementById('transactions-modal-title');
  const countEl = document.getElementById('transactions-modal-count');
  const totalEl = document.getElementById('transactions-modal-total');
  const listEl = document.getElementById('transactions-modal-list');
  
  if (!modal || !titleEl || !countEl || !totalEl || !listEl) return;
  
  // Set title - green since these are payments made (good!)
  const period = state.selectedFinancialYear || 'All Time';
  titleEl.textContent = `VAT Paid to HMRC - ${period}`;
  titleEl.className = 'income';
  
  // Show loading state
  listEl.innerHTML = '<div class="loading">Loading VAT payments...</div>';
  modal.style.display = 'flex';
  
  try {
    // Fetch VAT payments from all business accounts via dedicated endpoint
    const data = await fetchVATPayments(state.selectedFinancialYear ? { account: state.selectedAccount } : undefined);
    const vatPayments = data.payments;
    
    // Calculate total
    const total = vatPayments.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    // Update summary - green styling for paid amounts
    countEl.textContent = `${vatPayments.length} payment${vatPayments.length !== 1 ? 's' : ''}`;
    totalEl.textContent = formatCurrency(total);
    totalEl.className = 'modal-total income';
    
    // Render transactions - green since paid, with account source
    if (vatPayments.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No VAT payments found for the selected period.</p>';
    } else {
      listEl.innerHTML = vatPayments.map(t => {
        const date = new Date(t.date).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });
        // Get account label from config
        const accountLabel = getAccountConfig(t.account)?.label || t.account;
        return `
          <div class="transaction-item">
            <div class="transaction-info">
              <div class="transaction-desc">${t.description || 'HMRC VAT Payment'}</div>
              <div class="transaction-meta">${date} • ${accountLabel}</div>
            </div>
            <div class="transaction-amount income">
              ${formatCurrency(Math.abs(t.amount))}
            </div>
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

/**
 * Show VAT liability modal (income with VAT breakdown)
 */
async function showVatLiabilityModal(): Promise<void> {
  const modal = document.getElementById('transactions-modal');
  const titleEl = document.getElementById('transactions-modal-title');
  const countEl = document.getElementById('transactions-modal-count');
  const totalEl = document.getElementById('transactions-modal-total');
  const listEl = document.getElementById('transactions-modal-list');
  
  if (!modal || !titleEl || !countEl || !totalEl || !listEl) return;
  
  // Set title
  const period = state.selectedFinancialYear || 'All Time';
  titleEl.textContent = `Income (VAT Breakdown) - ${period}`;
  titleEl.className = 'income';
  
  // Show loading state
  listEl.innerHTML = '<div class="loading">Loading income transactions...</div>';
  modal.style.display = 'flex';
  
  try {
    // Fetch income transactions (excludes transfers by default)
    const data = await fetchTransactions({
      account: state.selectedAccount,
      type: 'income'
    });
    
    const incomeTransactions = data;
    
    // Sort by date descending
    incomeTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    // Calculate totals
    const totalIncome = incomeTransactions.reduce((sum: number, t) => sum + t.amount, 0);
    const totalVat = totalIncome / 6; // VAT at 20% on VAT-inclusive amount
    
    // Update summary
    countEl.textContent = `${incomeTransactions.length} transaction${incomeTransactions.length !== 1 ? 's' : ''}`;
    totalEl.innerHTML = `${formatCurrency(totalIncome)} <span style="color: var(--color-text-muted); font-size: 0.875rem;">(VAT: ${formatCurrency(totalVat)})</span>`;
    totalEl.className = 'modal-total income';
    
    // Render transactions with VAT breakdown
    if (incomeTransactions.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No income found for the selected period.</p>';
    } else {
      listEl.innerHTML = incomeTransactions.map(t => {
        const date = new Date(t.date).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });
        const vat = t.amount / 6; // VAT portion
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

/**
 * Render monthly chart
 */
function renderMonthlyChart(monthlyData: MonthlySummary[]): void {
  const ctx = document.getElementById('monthly-chart') as HTMLCanvasElement;
  if (!ctx) return;
  
  // Store for click handling
  currentMonthlyData = monthlyData;
  
  if (state.monthlyChart) {
    state.monthlyChart.destroy();
  }
  
  const labels = monthlyData.map(m => {
    const [year, month] = m.month.split('-');
    return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-GB', { 
      month: 'short', 
      year: '2-digit' 
    });
  });
  
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Income',
          data: monthlyData.map(m => m.income),
          backgroundColor: 'rgba(16, 185, 129, 0.8)',
          borderRadius: 4
        },
        {
          label: 'Outgoings',
          data: monthlyData.map(m => m.expenses),
          backgroundColor: 'rgba(239, 68, 68, 0.8)',
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_event, elements) => {
        if (elements && elements.length > 0) {
          const element = elements[0];
          const datasetIndex = element.datasetIndex;
          const index = element.index;
          const monthData = currentMonthlyData[index];
          const type = datasetIndex === 0 ? 'income' : 'expense';
          
          // Show transactions modal for this month/type
          showTransactionsModal(monthData.month, type);
        }
      },
      plugins: {
        legend: {
          position: 'bottom'
        },
        tooltip: {
          callbacks: {
            label: (context: unknown) => {
              const ctx = context as { raw: number; dataset: { label?: string } };
              const value = ctx.raw;
              return `${ctx.dataset.label}: £${value.toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value: unknown) => '£' + (value as number).toLocaleString()
          }
        }
      },
      onHover: (event: unknown, elements: unknown) => {
        const evt = event as { native?: { target?: HTMLElement } };
        const elems = elements as unknown[];
        const target = evt.native?.target;
        if (target) {
          target.style.cursor = (elems && elems.length > 0) ? 'pointer' : 'default';
        }
      }
    }
  });
  
  setState('monthlyChart', chart);
}

/**
 * Render monthly table
 */
function renderMonthlyTable(monthlyData: MonthlySummary[]): void {
  const container = document.getElementById('monthly-table');
  if (!container) return;
  
  if (monthlyData.length === 0) {
    container.innerHTML = '<p class="empty-state">No transaction data available. Add CSV statements to see summaries.</p>';
    return;
  }
  
  const html = `
    <table>
      <thead>
        <tr>
          <th>Month</th>
          <th>Income</th>
          <th>Outgoings</th>
          <th>Net</th>
          <th>VAT</th>
        </tr>
      </thead>
      <tbody>
        ${monthlyData.map(m => `
          <tr>
            <td>${m.month}</td>
            <td class="income">${formatCurrency(m.income)}</td>
            <td class="expense">${formatCurrency(m.expenses)}</td>
            <td class="${m.net >= 0 ? 'income' : 'expense'}">${formatCurrency(m.net)}</td>
            <td>${formatCurrency(m.vat)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  
  container.innerHTML = html;
}

/**
 * Load recent transactions
 */
async function loadRecentTransactions(): Promise<void> {
  try {
    const data = await fetchTransactions({
      account: state.selectedAccount
    });
    
    const transactions = data;
    const container = document.getElementById('recent-transactions');
    
    if (!container) return;
    
    if (!transactions || transactions.length === 0) {
      container.innerHTML = '<p class="empty-state">No transactions found for this account/period.</p>';
      return;
    }
    
    // Show all transactions (no limit since it's account-specific)
    const html = transactions.map((t) => `
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
    
    container.innerHTML = html;
  } catch (error) {
    console.error('Error loading transactions:', error);
  }
}

/**
 * Initialize dashboard module with all event listeners
 */
export function initDashboard(): void {
  initFinancialYearFilter();
  initAccountSelector();
  initBalanceModal();
  initTransactionsModal();
  initVatPaymentsHandler();
  initSummaryCardHandlers();
  
  // Load initial dashboard data
  loadDashboard();
}

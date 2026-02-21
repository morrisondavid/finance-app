/**
 * Bank Statements Dashboard - Frontend Application
 */

// Global state
let summaryData = null;
let statementsData = null;
let monthlyChart = null;
let selectedFinancialYear = '';
let selectedAccount = 'barclays-current';

// Account configuration - loaded from API on init (single source of truth: server/types.ts)
let accountConfig = {};

/**
 * Fetch account configuration from API
 * This must complete before the app can function properly
 */
async function loadAccountConfig() {
  try {
    const response = await fetch('/api/dashboard/accounts');
    const accounts = await response.json();
    
    // Convert array to object keyed by account name
    accountConfig = {};
    for (const account of accounts) {
      accountConfig[account.name] = account;
    }
    console.log('[Config] Loaded account configuration from API');
  } catch (error) {
    console.error('[Config] Error loading account config:', error);
    // Without config, the app cannot function correctly
    // Show error to user rather than using stale/hardcoded fallback
    throw new Error('Failed to load account configuration');
  }
}

// Get account config helper - returns config from API (the single source of truth)
function getAccountConfig(account) {
  const config = accountConfig[account];
  if (!config) {
    console.warn(`[Config] No config found for account: ${account}, using barclays-current`);
    // Return barclays-current config as fallback (from the loaded API data, not hardcoded)
    return accountConfig['barclays-current'];
  }
  return config;
}

// Format currency
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP'
  }).format(amount);
}

// Format account name for display
function formatAccountName(account) {
  return account
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Calculate next VAT due date
// UK VAT Stagger 2: Nov-Jan (due Mar 7), Feb-Apr (due Jun 7), May-Jul (due Sep 7), Aug-Oct (due Dec 7)
function getNextVatDueDate() {
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
  
  // Find the next due date
  const nextDue = dueDates.find(d => d > now) || dueDates[0];
  
  return nextDue.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ============================================
// Tab Navigation
// ============================================

function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(target).classList.add('active');
      
      // Load data for the tab
      if (target === 'dashboard') {
        loadDashboard();
      } else if (target === 'statements') {
        loadStatements();
      }
    });
  });
}

// ============================================
// Dashboard
// ============================================

async function loadDashboard() {
  try {
    const params = new URLSearchParams();
    params.set('account', selectedAccount);
    if (selectedFinancialYear) {
      params.set('fy', selectedFinancialYear);
    }
    
    const response = await fetch(`/api/dashboard/summary?${params}`);
    summaryData = await response.json();
    
    // Sync the selected financial year with what the backend returned
    // (backend defaults to current year if none specified)
    if (summaryData.selectedFinancialYear) {
      selectedFinancialYear = summaryData.selectedFinancialYear;
    }
    
    // Populate financial year dropdown
    populateFinancialYearFilter(summaryData.financialYears);
    
    // Update account selector indicators
    updateAccountIndicators(summaryData.byAccount);
    
    renderSummaryCards(summaryData);
    renderMonthlyChart(summaryData.monthly);
    renderMonthlyTable(summaryData.monthly);
    
    // Load transactions for the selected account
    loadRecentTransactions();
  } catch (error) {
    console.error('Error loading dashboard:', error);
  }
}

function populateFinancialYearFilter(financialYears) {
  const fyFilter = document.getElementById('fy-filter');
  if (!fyFilter || !financialYears || financialYears.length === 0) return;
  
  // Keep the current selection
  const currentValue = fyFilter.value;
  
  fyFilter.innerHTML = '<option value="">All Time</option>' +
    financialYears.map(fy => `<option value="${fy}">${fy}</option>`).join('');
  
  // Restore selection if it exists, otherwise default to current (first) year
  if (currentValue && financialYears.includes(currentValue)) {
    fyFilter.value = currentValue;
  } else if (selectedFinancialYear && financialYears.includes(selectedFinancialYear)) {
    fyFilter.value = selectedFinancialYear;
  } else {
    // Default to current year (first in list)
    fyFilter.value = financialYears[0];
    selectedFinancialYear = financialYears[0];
  }
}

function initFinancialYearFilter() {
  const fyFilter = document.getElementById('fy-filter');
  if (!fyFilter) return;
  
  fyFilter.addEventListener('change', () => {
    selectedFinancialYear = fyFilter.value;
    loadDashboard();
  });
}

function initAccountSelector() {
  const accountBtns = document.querySelectorAll('.account-btn');
  
  accountBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      accountBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update selected account and reload
      selectedAccount = btn.dataset.account;
      loadDashboard();
    });
  });
}

function updateAccountIndicators(accountData) {
  const accountBtns = document.querySelectorAll('.account-btn');
  
  accountBtns.forEach(btn => {
    const account = btn.dataset.account;
    const data = accountData[account];
    
    // Add indicator if account has data
    if (data && data.transactionCount > 0) {
      btn.classList.add('has-data');
    } else {
      btn.classList.remove('has-data');
    }
  });
}

function renderSummaryCards(data) {
  document.getElementById('total-income').textContent = formatCurrency(data.totals.income);
  document.getElementById('total-expenses').textContent = formatCurrency(data.totals.expenses);
  
  const netEl = document.getElementById('net-position');
  netEl.textContent = formatCurrency(data.totals.net);
  netEl.className = 'card-value ' + (data.totals.net >= 0 ? 'income' : 'expense');
  
  // Show transfer info if there are transfers
  const transferInfo = document.getElementById('transfer-info');
  if (data.transferCount && data.transferCount > 0) {
    transferInfo.style.display = 'block';
    document.getElementById('transfer-amount').textContent = formatCurrency(data.totals.transfersIn || 0);
    document.getElementById('transfer-count').textContent = data.transferCount;
  } else {
    transferInfo.style.display = 'none';
  }
  
  // Render balance panel
  renderBalancePanel(data.currentAccountBalance);
  
  // Render tax liabilities panel
  renderLiabilities(data.taxLiabilities, data.selectedFinancialYear);
}

function renderLiabilities(tax, financialYear) {
  const liabilitiesPanel = document.getElementById('liabilities-panel');
  const accountConfig = getAccountConfig(selectedAccount);
  
  // Only show tax liabilities for accounts configured to show them
  if (!accountConfig.showTaxLiabilities) {
    liabilitiesPanel.style.display = 'none';
    return;
  }
  liabilitiesPanel.style.display = 'block';
  
  if (!tax) return;
  
  // Update period label
  const periodEl = document.getElementById('liabilities-period');
  periodEl.textContent = financialYear || 'All Time';
  
  // VAT - Current Quarter
  document.getElementById('vat-outstanding').textContent = formatCurrency(tax.vatOwedThisQuarter || tax.vatOutstanding || 0);
  document.getElementById('vat-estimated').textContent = formatCurrency(tax.vatOnIncome || 0);
  document.getElementById('vat-paid').textContent = formatCurrency(tax.vatPaidLast4Quarters || tax.vatPaid || 0);
  
  // VAT quarter label, period, and due date
  if (tax.vatQuarter) {
    document.getElementById('vat-quarter-label').textContent = `(${tax.vatQuarter.label})`;
    
    // Format period dates (e.g., "1 Nov 2025 - 31 Jan 2026")
    const startDate = new Date(tax.vatQuarter.startDate);
    const endDate = new Date(tax.vatQuarter.endDate);
    const formatDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    document.getElementById('vat-period').textContent = `Period: ${formatDate(startDate)} - ${formatDate(endDate)}`;
    
    const dueDate = new Date(tax.vatQuarter.dueDate);
    document.getElementById('vat-due-date').textContent = `Due: ${formatDate(dueDate)}`;
  } else {
    document.getElementById('vat-quarter-label').textContent = '';
    document.getElementById('vat-period').textContent = 'Period: -';
    document.getElementById('vat-due-date').textContent = `Due: ${getNextVatDueDate()}`;
  }
  
  // Corporation Tax
  document.getElementById('corp-tax').textContent = formatCurrency(tax.corporationTax);
  document.getElementById('corp-tax-note').textContent = 
    `${tax.corporationTaxRate.toFixed(1)}% on ${formatCurrency(tax.taxableProfit)} profit`;
  
  // David's Personal Tax
  const davidTotal = tax.davidPayments?.total || 0;
  const davidSalary = tax.davidPayments?.salary || 0;
  const davidDividends = tax.davidPayments?.dividends || 0;
  
  document.getElementById('david-tax').textContent = formatCurrency(tax.davidTaxEstimate || 0);
  document.getElementById('david-tax-note').textContent = 
    `on ${formatCurrency(davidTotal)} payments`;
  
  // David's Breakdown
  document.getElementById('david-salary-paid').textContent = formatCurrency(davidSalary);
  document.getElementById('david-dividends-paid').textContent = formatCurrency(davidDividends);
  document.getElementById('david-dividend-tax').textContent = formatCurrency(tax.davidTaxBreakdown?.dividendTax || 0);
  
  // Always show David's breakdown
  const davidBreakdownEl = document.getElementById('david-breakdown');
  davidBreakdownEl.style.display = 'block';
  
  // Heena's Personal Tax
  const heenaTotal = tax.heenaPayments?.total || 0;
  const heenaSalary = tax.heenaPayments?.salary || 0;
  const heenaDividends = tax.heenaPayments?.dividends || 0;
  
  document.getElementById('heena-tax').textContent = formatCurrency(tax.heenaTaxEstimate || 0);
  document.getElementById('heena-tax-note').textContent = 
    `on ${formatCurrency(heenaTotal)} payments`;
  
  // Heena's Breakdown
  document.getElementById('heena-salary-paid').textContent = formatCurrency(heenaSalary);
  document.getElementById('heena-dividends-paid').textContent = formatCurrency(heenaDividends);
  document.getElementById('heena-dividend-tax').textContent = formatCurrency(tax.heenaTaxBreakdown?.dividendTax || 0);
  
  // Always show Heena's breakdown
  const heenaBreakdownEl = document.getElementById('heena-breakdown');
  heenaBreakdownEl.style.display = 'block';
}

function renderBalancePanel(balance) {
  if (!balance) return;
  
  // Opening balance
  const openingBalanceEl = document.getElementById('opening-balance');
  const openingDateEl = document.getElementById('opening-balance-date');
  openingBalanceEl.textContent = formatCurrency(balance.openingBalance);
  if (balance.openingBalanceDate) {
    openingDateEl.textContent = `as of ${balance.openingBalanceDate}`;
  } else if (balance.openingBalance === 0) {
    openingDateEl.textContent = 'Not set - click to set';
  } else {
    openingDateEl.textContent = '';
  }
  
  // Transaction total
  const transactionTotalEl = document.getElementById('transaction-total');
  const transactionRangeEl = document.getElementById('transaction-date-range');
  transactionTotalEl.textContent = formatCurrency(balance.transactionTotal);
  transactionTotalEl.className = 'balance-value ' + (balance.transactionTotal >= 0 ? '' : 'expense');
  
  if (balance.oldestTransaction && balance.newestTransaction) {
    transactionRangeEl.textContent = `${balance.oldestTransaction} to ${balance.newestTransaction}`;
  } else if (balance.transactionCount === 0) {
    transactionRangeEl.textContent = 'No transactions';
  } else {
    transactionRangeEl.textContent = '';
  }
  
  // Current balance
  const currentBalanceEl = document.getElementById('current-balance');
  currentBalanceEl.textContent = formatCurrency(balance.currentBalance);
}

// ============================================
// Balance Modal
// ============================================

function initBalanceModal() {
  const editBtn = document.getElementById('edit-balance-btn');
  const modal = document.getElementById('balance-modal');
  const cancelBtn = document.getElementById('cancel-balance-btn');
  const saveBtn = document.getElementById('save-balance-btn');
  const balanceInput = document.getElementById('opening-balance-input');
  const dateInput = document.getElementById('opening-balance-date-input');
  
  // Open modal
  editBtn.addEventListener('click', () => {
    // Pre-fill with current values if available
    if (summaryData && summaryData.currentAccountBalance) {
      const balance = summaryData.currentAccountBalance;
      balanceInput.value = balance.openingBalance || '';
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
      const response = await fetch(`/api/dashboard/balance/${selectedAccount}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ balance, date })
      });
      
      if (response.ok) {
        modal.style.display = 'none';
        // Reload dashboard to get updated balance
        loadDashboard();
      } else {
        const error = await response.json();
        alert('Error saving balance: ' + error.error);
      }
    } catch (error) {
      alert('Error saving balance: ' + error.message);
    }
  });
}

// ============================================
// Transactions Modal (Chart Click)
// ============================================

function initTransactionsModal() {
  const modal = document.getElementById('transactions-modal');
  const closeBtn = document.getElementById('close-transactions-modal');
  
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

async function showTransactionsModal(month, type) {
  const modal = document.getElementById('transactions-modal');
  const titleEl = document.getElementById('transactions-modal-title');
  const countEl = document.getElementById('transactions-modal-count');
  const totalEl = document.getElementById('transactions-modal-total');
  const listEl = document.getElementById('transactions-modal-list');
  
  // Parse month for display
  const [year, monthNum] = month.split('-');
  const monthName = new Date(year, monthNum - 1).toLocaleDateString('en-GB', { 
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
    const params = new URLSearchParams();
    params.set('account', selectedAccount);
    params.set('year', year);
    params.set('month', monthNum);
    params.set('type', type);
    
    const response = await fetch(`/api/dashboard/transactions?${params}`);
    const transactions = await response.json();
    
    // Calculate total
    const total = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
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

// ============================================
// VAT Payments Modal
// ============================================

function initVatPaymentsHandler() {
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

// ============================================
// Summary Card Click Handlers
// ============================================

function initSummaryCardHandlers() {
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

async function showAllTransactionsModal(type) {
  const modal = document.getElementById('transactions-modal');
  const titleEl = document.getElementById('transactions-modal-title');
  const countEl = document.getElementById('transactions-modal-count');
  const totalEl = document.getElementById('transactions-modal-total');
  const listEl = document.getElementById('transactions-modal-list');
  
  // Set title
  const period = selectedFinancialYear || 'All Time';
  const typeLabel = type === 'income' ? 'Income' : 'Outgoings';
  titleEl.textContent = `${typeLabel} - ${period}`;
  titleEl.className = type;
  
  // Show loading state
  listEl.innerHTML = '<div class="loading">Loading transactions...</div>';
  modal.style.display = 'flex';
  
  try {
    // Fetch transactions for this type
    const params = new URLSearchParams();
    params.set('account', selectedAccount);
    params.set('type', type);
    if (selectedFinancialYear) {
      params.set('fy', selectedFinancialYear);
    }
    
    const response = await fetch(`/api/dashboard/transactions?${params}`);
    const transactions = await response.json();
    
    // Sort by date descending
    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Calculate total
    const total = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
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

async function showVatPaymentsModal() {
  const modal = document.getElementById('transactions-modal');
  const titleEl = document.getElementById('transactions-modal-title');
  const countEl = document.getElementById('transactions-modal-count');
  const totalEl = document.getElementById('transactions-modal-total');
  const listEl = document.getElementById('transactions-modal-list');
  
  // Set title - green since these are payments made (good!)
  const period = selectedFinancialYear || 'All Time';
  titleEl.textContent = `VAT Paid to HMRC - ${period}`;
  titleEl.className = 'income';
  
  // Show loading state
  listEl.innerHTML = '<div class="loading">Loading VAT payments...</div>';
  modal.style.display = 'flex';
  
  try {
    // Fetch VAT payments from all business accounts via dedicated endpoint
    const params = new URLSearchParams();
    if (selectedFinancialYear) {
      params.set('fy', selectedFinancialYear);
    }
    
    const response = await fetch(`/api/tax/vat-payments?${params}`);
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    const vatPayments = await response.json();
    
    // Ensure vatPayments is an array
    if (!Array.isArray(vatPayments)) {
      console.error('VAT payments response is not an array:', vatPayments);
      throw new Error('Invalid response format');
    }
    
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
    console.error('Error loading VAT payments:', error);
    listEl.innerHTML = `<p class="error">Error loading VAT payments: ${error.message}</p>`;
  }
}

async function showVatLiabilityModal() {
  const modal = document.getElementById('transactions-modal');
  const titleEl = document.getElementById('transactions-modal-title');
  const countEl = document.getElementById('transactions-modal-count');
  const totalEl = document.getElementById('transactions-modal-total');
  const listEl = document.getElementById('transactions-modal-list');
  
  // Set title
  const period = selectedFinancialYear || 'All Time';
  titleEl.textContent = `Income (VAT Breakdown) - ${period}`;
  titleEl.className = 'income';
  
  // Show loading state
  listEl.innerHTML = '<div class="loading">Loading income transactions...</div>';
  modal.style.display = 'flex';
  
  try {
    // Fetch income transactions (excludes transfers by default)
    const params = new URLSearchParams();
    params.set('account', selectedAccount);
    params.set('type', 'income');
    if (selectedFinancialYear) {
      params.set('fy', selectedFinancialYear);
    }
    
    const response = await fetch(`/api/dashboard/transactions?${params}`);
    const incomeTransactions = await response.json();
    
    // Sort by date descending
    incomeTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Calculate totals
    const totalIncome = incomeTransactions.reduce((sum, t) => sum + t.amount, 0);
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

// Store monthly data for chart click handling
let currentMonthlyData = [];

function renderMonthlyChart(monthlyData) {
  const ctx = document.getElementById('monthly-chart');
  
  // Store for click handling
  currentMonthlyData = monthlyData;
  
  if (monthlyChart) {
    monthlyChart.destroy();
  }
  
  const labels = monthlyData.map(m => {
    const [year, month] = m.month.split('-');
    return new Date(year, month - 1).toLocaleDateString('en-GB', { 
      month: 'short', 
      year: '2-digit' 
    });
  });
  
  monthlyChart = new Chart(ctx, {
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
      onClick: (event, elements) => {
        if (elements.length > 0) {
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
            label: (context) => {
              const value = context.raw;
              return `${context.dataset.label}: £${value.toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: value => '£' + value.toLocaleString()
          }
        }
      },
      // Change cursor on hover
      onHover: (event, elements) => {
        event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      }
    }
  });
}

function renderMonthlyTable(monthlyData) {
  const container = document.getElementById('monthly-table');
  
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

function renderAccountBreakdown(accountData) {
  const container = document.getElementById('account-breakdown');
  
  const accounts = Object.entries(accountData);
  
  if (accounts.every(([, data]) => data.transactionCount === 0)) {
    container.innerHTML = '<p class="empty-state">No data yet</p>';
    return;
  }
  
  const html = accounts.map(([account, data]) => `
    <div class="account-item">
      <div class="account-name">${formatAccountName(account)}</div>
      <div class="account-stats">
        <div class="income">+${formatCurrency(data.income)}</div>
        <div class="expense">-${formatCurrency(data.expenses)}</div>
        <div>${data.transactionCount} transactions</div>
      </div>
    </div>
  `).join('');
  
  container.innerHTML = html;
}

async function loadRecentTransactions() {
  try {
    const params = new URLSearchParams();
    params.set('account', selectedAccount);
    if (selectedFinancialYear) {
      params.set('fy', selectedFinancialYear);
    }
    
    const response = await fetch(`/api/dashboard/transactions?${params}`);
    const transactions = await response.json();
    
    const container = document.getElementById('recent-transactions');
    
    if (transactions.length === 0) {
      container.innerHTML = '<p class="empty-state">No transactions found for this account/period.</p>';
      return;
    }
    
    // Show all transactions (no limit since it's account-specific)
    const html = transactions.map(t => `
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

// ============================================
// Statements
// ============================================

// VAT Quarter definitions (Stagger 2: Nov-Jan, Feb-Apr, May-Jul, Aug-Oct)
// Q1 spans two calendar years (Nov-Dec of prev year + Jan of current year)
const VAT_QUARTERS = {
  Q1: { name: 'Q1 (Nov-Jan)', months: [11, 12, 1], crossYear: true },
  Q2: { name: 'Q2 (Feb-Apr)', months: [2, 3, 4], crossYear: false },
  Q3: { name: 'Q3 (May-Jul)', months: [5, 6, 7], crossYear: false },
  Q4: { name: 'Q4 (Aug-Oct)', months: [8, 9, 10], crossYear: false }
};

// Track if initial load (no filters = show prompt instead of all files)
let hasAppliedFilter = false;

async function loadStatements(search = '', year = '', month = '', quarter = '') {
  try {
    // Check if any filter is applied
    hasAppliedFilter = !!(search || year || month || quarter);
    
    // If no filter, just show the prompt - don't fetch all files
    if (!hasAppliedFilter) {
      renderStatementsPrompt();
      updateFileCount(null);
      updateDownloadButton();
      return;
    }
    
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (year) params.set('year', year);
    if (month) params.set('month', month);
    if (quarter) params.set('quarter', quarter);
    
    const response = await fetch(`/api/statements?${params}`);
    statementsData = await response.json();
    
    renderStatements(statementsData);
    updateFileCount(statementsData);
    updateDownloadButton();
  } catch (error) {
    console.error('Error loading statements:', error);
  }
}

// Load available years for the year filter (lightweight call)
async function loadAvailableYears() {
  try {
    const response = await fetch('/api/statements/years');
    const years = await response.json();
    populateYearFilter(years);
  } catch (error) {
    console.error('Error loading years:', error);
  }
}

function renderStatementsPrompt() {
  const container = document.getElementById('statements-list');
  container.innerHTML = `
    <div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 6h18"/>
        <path d="M7 12h10"/>
        <path d="M10 18h4"/>
      </svg>
      <p>Select a year or VAT quarter to view statements</p>
      <p class="empty-state-hint">Use the filters above to find your bank statements</p>
    </div>
  `;
}

function renderStatements(data) {
  const container = document.getElementById('statements-list');
  const selectionControls = document.querySelector('.selection-controls');
  
  const accounts = Object.entries(data);
  const hasAnyFiles = accounts.some(([, files]) => 
    files.pdf.length > 0 || files.csv.length > 0
  );
  
  if (!hasAnyFiles) {
    container.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <p>No statements found for the selected filters</p>
      </div>
    `;
    if (selectionControls) selectionControls.style.display = 'none';
    return;
  }
  
  // Show selection controls when files are displayed
  if (selectionControls) selectionControls.style.display = 'flex';
  
  // Get expected months if quarter is selected
  const quarterFilter = document.getElementById('quarter-filter');
  const expectedMonths = quarterFilter && quarterFilter.value ? getExpectedMonthsForQuarter(quarterFilter.value) : null;
  
  const html = accounts.map(([account, files]) => {
    const pdfFiles = files.pdf
      .map(f => ({ ...f, type: 'pdf' }))
      .sort((a, b) => b.displayDate.localeCompare(a.displayDate));
    
    const csvFiles = files.csv
      .map(f => ({ ...f, type: 'csv' }))
      .sort((a, b) => b.displayDate.localeCompare(a.displayDate));
    
    if (pdfFiles.length === 0 && csvFiles.length === 0) return '';
    
    // Check for missing files if viewing a quarter
    let missingPdfs = [];
    let missingCsvs = [];
    if (expectedMonths) {
      expectedMonths.forEach(monthKey => {
        const hasPdf = pdfFiles.some(f => f.displayDate === monthKey);
        const hasCsv = csvFiles.some(f => f.displayDate === monthKey);
        if (!hasPdf) missingPdfs.push(monthKey);
        if (!hasCsv) missingCsvs.push(monthKey);
      });
    }
    
    return `
      <div class="account-section">
        <h3>${formatAccountName(account)}</h3>
        
        <div class="file-type-section">
          <h4 class="file-type-header">
            <span class="file-type-icon pdf">PDF</span>
            PDF Statements (${pdfFiles.length})
          </h4>
          <div class="file-list">
            ${pdfFiles.length > 0 ? pdfFiles.map(file => renderFileItem(account, file)).join('') : '<div class="missing-file-notice">No PDF statements</div>'}
          </div>
          ${missingPdfs.length > 0 ? `
            <div class="missing-file-notice">
              Missing PDFs: ${missingPdfs.map(m => formatMonthYear(m)).join(', ')}
            </div>
          ` : ''}
        </div>
        
        <div class="file-type-section">
          <h4 class="file-type-header">
            <span class="file-type-icon csv">CSV</span>
            CSV Data Files (${csvFiles.length})
          </h4>
          <div class="file-list">
            ${csvFiles.length > 0 ? csvFiles.map(file => renderFileItem(account, file)).join('') : '<div class="missing-file-notice">No CSV files</div>'}
          </div>
          ${missingCsvs.length > 0 ? `
            <div class="missing-file-notice">
              Missing CSVs: ${missingCsvs.map(m => formatMonthYear(m)).join(', ')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
}

function getExpectedMonthsForQuarter(quarter) {
  const match = quarter.match(/^(Q[1-4])-(\d{4})$/);
  if (!match) return null;
  
  const qNum = match[1];
  const year = parseInt(match[2]);
  
  switch (qNum) {
    case 'Q1': // Nov-Jan
      return [
        `${year - 1}-11`,
        `${year - 1}-12`,
        `${year}-01`
      ];
    case 'Q2': // Feb-Apr
      return [
        `${year}-02`,
        `${year}-03`,
        `${year}-04`
      ];
    case 'Q3': // May-Jul
      return [
        `${year}-05`,
        `${year}-06`,
        `${year}-07`
      ];
    case 'Q4': // Aug-Oct
      return [
        `${year}-08`,
        `${year}-09`,
        `${year}-10`
      ];
    default:
      return null;
  }
}

function formatMonthYear(dateStr) {
  const [year, month] = dateStr.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
}

// Selection state
let selectedFiles = new Set();

function renderFileItem(account, file) {
  const fileKey = `${account}:${file.type}:${file.filename}`;
  const isChecked = selectedFiles.has(fileKey);
  
  return `
    <div class="file-item">
      <input type="checkbox" 
             class="file-checkbox" 
             data-account="${account}" 
             data-type="${file.type}" 
             data-filename="${file.filename}"
             ${isChecked ? 'checked' : ''}
             onchange="toggleFileSelection('${account}', '${file.type}', '${file.filename}')">
      <div class="file-info">
        <div>
          <div class="file-name">${file.filename}</div>
          <div class="file-date">${file.displayDate}</div>
        </div>
      </div>
      <button class="download-btn" onclick="downloadFile('${account}', '${file.type}', '${file.filename}')">
        Download
      </button>
    </div>
  `;
}

function toggleFileSelection(account, type, filename) {
  const fileKey = `${account}:${type}:${filename}`;
  if (selectedFiles.has(fileKey)) {
    selectedFiles.delete(fileKey);
  } else {
    selectedFiles.add(fileKey);
  }
  updateSelectionControls();
}

function updateSelectionControls() {
  const downloadSelectedBtn = document.getElementById('download-selected-btn');
  const selectionCount = document.getElementById('selection-count');
  const selectionCountBadge = document.getElementById('selection-count-badge');
  
  if (downloadSelectedBtn) {
    downloadSelectedBtn.disabled = selectedFiles.size === 0;
  }
  
  if (selectionCount) {
    selectionCount.textContent = selectedFiles.size > 0 ? `${selectedFiles.size} file${selectedFiles.size !== 1 ? 's' : ''} selected` : 'No files selected';
  }
  
  if (selectionCountBadge) {
    selectionCountBadge.textContent = selectedFiles.size > 0 ? `(${selectedFiles.size})` : '';
  }
}

function populateYearFilter(years) {
  const yearFilter = document.getElementById('year-filter');
  
  // Preserve current selection before rebuilding
  const currentValue = yearFilter.value;
  
  const sortedYears = Array.isArray(years) ? years : [];
  
  // Rebuild with "Select Year" as first option
  yearFilter.innerHTML = '<option value="">Select Year</option>' +
    sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
  
  // Restore previous selection if it still exists in the options
  if (currentValue && sortedYears.includes(currentValue)) {
    yearFilter.value = currentValue;
  } else {
    yearFilter.value = '';
  }
  
  // Update quarter filter based on year selection
  updateQuarterOptions();
}

function updateQuarterOptions() {
  const yearFilter = document.getElementById('year-filter');
  const quarterFilter = document.getElementById('quarter-filter');
  const selectedYear = yearFilter.value;
  const currentQuarter = quarterFilter.value;
  
  if (!selectedYear) {
    // No year selected - show empty quarter filter
    quarterFilter.innerHTML = '<option value="">Select year first</option>';
    quarterFilter.disabled = true;
    return;
  }
  
  quarterFilter.disabled = false;
  const year = parseInt(selectedYear);
  const prevYear = year - 1;
  
  // Generate quarters for the selected year (Stagger 2)
  // Q1: Nov-Jan (spans prevYear-year)
  // Q2: Feb-Apr
  // Q3: May-Jul
  // Q4: Aug-Oct
  quarterFilter.innerHTML = `
    <option value="">VAT Quarter</option>
    <option value="Q1-${year}">Q1 Nov-Jan ${prevYear}/${year.toString().slice(-2)}</option>
    <option value="Q2-${year}">Q2 Feb-Apr ${year}</option>
    <option value="Q3-${year}">Q3 May-Jul ${year}</option>
    <option value="Q4-${year}">Q4 Aug-Oct ${year}</option>
  `;
  
  // Restore selection if it matches the year
  if (currentQuarter && currentQuarter.endsWith(`-${year}`)) {
    quarterFilter.value = currentQuarter;
  } else {
    quarterFilter.value = '';
  }
}

function updateFileCount(data) {
  const fileCountEl = document.getElementById('file-count');
  
  if (!data) {
    fileCountEl.textContent = '';
    return;
  }
  
  let totalFiles = 0;
  
  Object.values(data).forEach(files => {
    totalFiles += files.pdf.length + files.csv.length;
  });
  
  if (totalFiles > 0) {
    fileCountEl.textContent = `${totalFiles} file${totalFiles !== 1 ? 's' : ''} found`;
  } else {
    fileCountEl.textContent = 'No files found';
  }
}

function updateDownloadButton() {
  const downloadBtn = document.getElementById('download-all-btn');
  const quarterFilter = document.getElementById('quarter-filter');
  const yearFilter = document.getElementById('year-filter');
  const monthFilter = document.getElementById('month-filter');
  
  // Show download button only when filters are applied
  const hasFilter = quarterFilter.value || yearFilter.value || monthFilter.value;
  downloadBtn.style.display = hasFilter ? 'inline-block' : 'none';
}

function downloadFile(account, type, filename) {
  window.location.href = `/api/statements/download/${account}/${type}/${encodeURIComponent(filename)}`;
}

function initSearch() {
  const searchBtn = document.getElementById('search-btn');
  const searchInput = document.getElementById('search-input');
  const yearFilter = document.getElementById('year-filter');
  const monthFilter = document.getElementById('month-filter');
  const quarterFilter = document.getElementById('quarter-filter');
  const downloadAllBtn = document.getElementById('download-all-btn');
  const downloadAccountantBtn = document.getElementById('download-accountant-btn');
  const accountantStatus = document.getElementById('accountant-status');
  const missingFilesWarning = document.getElementById('missing-files-warning');
  
  // Initialize quarter filter as disabled (needs year first)
  quarterFilter.disabled = true;
  quarterFilter.innerHTML = '<option value="">Select year first</option>';
  
  const doSearch = () => {
    loadStatements(
      searchInput.value,
      yearFilter.value,
      monthFilter.value,
      quarterFilter.value
    );
  };
  
  // Update accountant button state based on quarter selection
  const updateAccountantButton = () => {
    const quarterSelected = quarterFilter.value !== '';
    downloadAccountantBtn.disabled = !quarterSelected;
    
    if (quarterSelected) {
      // Parse quarter value like "Q1-2025" to get friendly name
      const match = quarterFilter.value.match(/^(Q[1-4])-(\d{4})$/);
      if (match) {
        const quarterNames = {
          Q1: 'Nov-Jan',
          Q2: 'Feb-Apr', 
          Q3: 'May-Jul',
          Q4: 'Aug-Oct'
        };
        const qNum = match[1];
        const year = parseInt(match[2]);
        const prevYear = year - 1;
        const quarterName = quarterNames[qNum];
        
        if (qNum === 'Q1') {
          accountantStatus.textContent = `Ready to export ${qNum} (${quarterName} ${prevYear}/${year.toString().slice(-2)}) for all business accounts`;
        } else {
          accountantStatus.textContent = `Ready to export ${qNum} (${quarterName} ${year}) for all business accounts`;
        }
      }
    } else if (yearFilter.value) {
      accountantStatus.textContent = 'Select a VAT quarter to download';
    } else {
      accountantStatus.textContent = 'Select a year and VAT quarter above';
    }
    
    // Hide missing files warning when selection changes
    missingFilesWarning.style.display = 'none';
  };
  
  // When quarter is selected, disable month filter (quarter takes precedence over month)
  const updateFilterState = () => {
    const quarterSelected = quarterFilter.value !== '';
    monthFilter.disabled = quarterSelected;
    
    if (quarterSelected) {
      monthFilter.value = '';
    }
    
    updateAccountantButton();
  };
  
  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') doSearch();
  });
  
  yearFilter.addEventListener('change', () => {
    // Update quarter options based on selected year
    updateQuarterOptions();
    // Clear month filter when year changes
    monthFilter.disabled = false;
    updateAccountantButton();
    doSearch();
  });
  
  monthFilter.addEventListener('change', () => {
    // Clear quarter when month is manually selected
    quarterFilter.value = '';
    updateAccountantButton();
    doSearch();
  });
  
  quarterFilter.addEventListener('change', () => {
    updateFilterState();
    doSearch();
  });
  
  // Download all button handler
  downloadAllBtn.addEventListener('click', async () => {
    const params = new URLSearchParams();
    if (searchInput.value) params.set('search', searchInput.value);
    if (quarterFilter.value) params.set('quarter', quarterFilter.value);
    if (yearFilter.value) params.set('year', yearFilter.value);
    if (monthFilter.value) params.set('month', monthFilter.value);
    
    downloadAllBtn.disabled = true;
    downloadAllBtn.textContent = 'Preparing...';
    
    try {
      window.location.href = `/api/statements/download-all?${params}`;
    } finally {
      // Re-enable button after a delay (download starts in new request)
      setTimeout(() => {
        downloadAllBtn.disabled = false;
        downloadAllBtn.textContent = 'Download All';
      }, 2000);
    }
  });
  
  // Download for Accountant button handler
  downloadAccountantBtn.addEventListener('click', async () => {
    if (!quarterFilter.value) return;
    
    downloadAccountantBtn.disabled = true;
    downloadAccountantBtn.textContent = 'Preparing ZIP...';
    downloadAccountantBtn.classList.add('loading');
    
    try {
      // First check for missing files
      const checkResponse = await fetch(`/api/statements/check-quarter?quarter=${quarterFilter.value}`);
      const checkData = await checkResponse.json();
      
      // Show missing files warning if any
      if (checkData.missingFiles && checkData.missingFiles.length > 0) {
        missingFilesWarning.innerHTML = `
          <strong>Some files may be missing:</strong>
          <ul>
            ${checkData.missingFiles.map(m => `<li>${m}</li>`).join('')}
          </ul>
        `;
        missingFilesWarning.style.display = 'block';
      } else {
        missingFilesWarning.style.display = 'none';
      }
      
      // Proceed with download
      window.location.href = `/api/statements/download-for-accountant?quarter=${quarterFilter.value}`;
    } catch (error) {
      console.error('Error preparing accountant package:', error);
      accountantStatus.textContent = 'Error preparing package. Please try again.';
    } finally {
      // Re-enable button after a delay
      setTimeout(() => {
        downloadAccountantBtn.disabled = false;
        downloadAccountantBtn.textContent = 'Download for Accountant';
        downloadAccountantBtn.classList.remove('loading');
        updateAccountantButton();
      }, 2000);
    }
  });
  
  // Selection control handlers
  const selectAllBtn = document.getElementById('select-all-btn');
  const clearSelectionBtn = document.getElementById('clear-selection-btn');
  const downloadSelectedBtn = document.getElementById('download-selected-btn');
  
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      // Select all visible checkboxes
      document.querySelectorAll('.file-checkbox').forEach(checkbox => {
        checkbox.checked = true;
        const account = checkbox.dataset.account;
        const type = checkbox.dataset.type;
        const filename = checkbox.dataset.filename;
        const fileKey = `${account}:${type}:${filename}`;
        selectedFiles.add(fileKey);
      });
      updateSelectionControls();
    });
  }
  
  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener('click', () => {
      selectedFiles.clear();
      document.querySelectorAll('.file-checkbox').forEach(checkbox => {
        checkbox.checked = false;
      });
      updateSelectionControls();
    });
  }
  
  if (downloadSelectedBtn) {
    downloadSelectedBtn.addEventListener('click', async () => {
      if (selectedFiles.size === 0) return;
      
      downloadSelectedBtn.disabled = true;
      downloadSelectedBtn.textContent = 'Preparing ZIP...';
      
      try {
        // Convert selectedFiles Set to array of objects
        const files = Array.from(selectedFiles).map(key => {
          const [account, type, filename] = key.split(':');
          return { account, type, filename };
        });
        
        // Send POST request with selected files
        const response = await fetch('/api/statements/download-selected', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files })
        });
        
        if (response.ok) {
          // Trigger download
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'selected-statements.zip';
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        } else {
          alert('Error downloading files. Please try again.');
        }
      } catch (error) {
        console.error('Error downloading selected files:', error);
        alert('Error downloading files. Please try again.');
      } finally {
        setTimeout(() => {
          downloadSelectedBtn.disabled = selectedFiles.size === 0;
          downloadSelectedBtn.textContent = 'Download Selected';
        }, 1000);
      }
    });
  }
  
  // Load available years and show initial prompt
  loadAvailableYears();
  renderStatementsPrompt();
}

// ============================================
// File Upload
// ============================================

function initUpload() {
  // Statements upload
  initDropzone(
    'dropzone-statements',
    'file-input-statements',
    'upload-status-statements',
    () => {
      const account = document.getElementById('upload-account').value;
      const type = document.getElementById('upload-type').value;
      return `/api/upload/${account}/${type}`;
    }
  );
  
  // Invoices upload
  initDropzone(
    'dropzone-invoices',
    'file-input-invoices',
    'upload-status-invoices',
    () => '/api/upload/invoices'
  );
}

function initDropzone(dropzoneId, inputId, statusId, getUrl) {
  const dropzone = document.getElementById(dropzoneId);
  const fileInput = document.getElementById(inputId);
  const status = document.getElementById(statusId);
  
  // Click to browse
  dropzone.addEventListener('click', () => fileInput.click());
  
  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      uploadFiles(fileInput.files, getUrl(), status);
      fileInput.value = '';
    }
  });
  
  // Drag and drop
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });
  
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files, getUrl(), status);
    }
  });
}

async function uploadFiles(files, url, statusEl) {
  const formData = new FormData();
  
  for (const file of files) {
    formData.append('files', file);
  }
  
  statusEl.innerHTML = '<div class="loading">Uploading...</div>';
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });
    
    const result = await response.json();
    
    if (response.ok) {
      statusEl.innerHTML = `<div class="success">${result.message}</div>`;
      
      // Refresh data
      setTimeout(() => {
        loadDashboard();
        loadStatements();
        statusEl.innerHTML = '';
      }, 2000);
    } else {
      statusEl.innerHTML = `<div class="error">Error: ${result.error}</div>`;
    }
  } catch (error) {
    statusEl.innerHTML = `<div class="error">Upload failed: ${error.message}</div>`;
  }
}

// ============================================
// Initialize
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Load account configuration first (from API)
  await loadAccountConfig();
  
  initTabs();
  initSearch();
  initUpload();
  initFinancialYearFilter();
  initAccountSelector();
  initBalanceModal();
  initTransactionsModal();
  initVatPaymentsHandler();
  initSummaryCardHandlers();
  
  // Load initial data
  loadDashboard();
});

// Make downloadFile available globally
window.downloadFile = downloadFile;

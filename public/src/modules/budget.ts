/**
 * Expenses sheet — recurring / fixed monthly and annual costs only (household).
 */

import type { ExpensesInsight, ExpensesLineItem, ExpensesSection, ExpensesSheetResponse } from '../../../shared/api-contracts.js';
import { fetchBudgetOverview } from '../utils/api';
import { formatCurrency } from '../utils/formatting';

export function initBudget(): void {
  const varianceModal = document.getElementById('expenses-variance-modal');
  const varianceClose = document.getElementById('expenses-variance-modal-close');
  if (varianceModal && varianceClose) {
    varianceClose.addEventListener('click', () => {
      varianceModal.style.display = 'none';
    });
    varianceModal.addEventListener('click', (e) => {
      if (e.target === varianceModal) varianceModal.style.display = 'none';
    });
  }

  document.querySelectorAll<HTMLButtonElement>('.expenses-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-expenses-tab');
      if (tab !== 'monthly' && tab !== 'annual') return;
      document.querySelectorAll('.expenses-tab-btn').forEach(b => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
      });
      const monthlyPanel = document.getElementById('expenses-panel-monthly');
      const annualPanel = document.getElementById('expenses-panel-annual');
      if (monthlyPanel) monthlyPanel.hidden = tab !== 'monthly';
      if (annualPanel) annualPanel.hidden = tab !== 'annual';
    });
  });
}

export async function loadBudget(): Promise<void> {
  try {
    const data = await fetchBudgetOverview();

    setPeriodLine(data);
    renderMonthlyInsight(data);
    renderAnnualSummaryPods(data);
    renderMonthlyOutgoings(data.monthlyOutgoings);
    renderIncomeTable('expenses-income-monthly-table', data.incomeMonthly.items, '/mo');
    renderAnnualOutgoings(data.annualOutgoings);
    renderAnnualIncome(data);
  } catch (error) {
    console.error('[Budget] Error loading expenses sheet:', error);
  }
}

function setPeriodLine(data: ExpensesSheetResponse): void {
  const el = document.getElementById('expenses-period-line');
  if (el) {
    el.textContent = `${data.summary.periodDescription} · ${data.summary.monthsCovered} month${data.summary.monthsCovered !== 1 ? 's' : ''} of transaction data`;
  }
}

function renderMonthlyInsight(data: ExpensesSheetResponse): void {
  const ins = data.insight;
  const primary = document.getElementById('expenses-insight-primary-table');
  const debt = document.getElementById('expenses-insight-debt-table');
  const footnote = document.getElementById('expenses-insight-footnote');
  if (primary) {
    primary.innerHTML = buildPrimaryInsightMarkup(ins);
  }
  if (debt) {
    debt.innerHTML = buildDebtInsightMarkup(ins);
  }
  if (footnote) {
    footnote.textContent =
      'Recurring fixed costs only (rolling window). Passive income is recurring monthly income minus lines classified as salary. The key figure for “income dried up” is Money needed in joint account — same as Net Personal Expenses (salary excluded).';
  }
}

function divAmount(v: number | null): string {
  return v === null ? '—' : formatCurrency(v);
}

function buildPrimaryInsightMarkup(ins: ExpensesInsight): string {
  const f = formatCurrency;
  return `
<tbody>
  <tr class="expenses-insight-row-bold"><td>Total Expenses</td><td class="expenses-col-amount">${f(ins.totalFixedMonthlyExpenses)}</td></tr>
  <tr class="expenses-insight-row-bold"><td>Net Expenses (salary included)</td><td class="expenses-col-amount">${f(ins.netExpensesSalaryIncluded)}</td></tr>
  <tr class="expenses-insight-row-bold"><td>Net Expenses (salary excluded)</td><td class="expenses-col-amount">${f(ins.netExpensesSalaryExcluded)}</td></tr>
  <tr class="expenses-insight-row-bold"><td>Net Personal Expenses (salary excluded)</td><td class="expenses-col-amount">${f(ins.netPersonalExpensesSalaryExcluded)}</td></tr>
  <tr class="expenses-insight-row-sub"><td>— Business Expenses</td><td class="expenses-col-amount">${f(ins.businessExpenses)}</td></tr>
  <tr class="expenses-insight-row-sub"><td>— Business Expenses (salary excluded)</td><td class="expenses-col-amount">${f(ins.businessExpensesSalaryExcluded)}</td></tr>
  <tr class="expenses-insight-row-sub"><td>— Total Salary</td><td class="expenses-col-amount">${f(ins.totalSalary)}</td></tr>
  <tr class="expenses-insight-row-sub"><td>— Personal Expenses</td><td class="expenses-col-amount">${f(ins.personalExpenses)}</td></tr>
  <tr class="expenses-insight-row-sub"><td>— Quality of Life Expenses</td><td class="expenses-col-amount">${f(ins.qualityOfLifeExpenses)}</td></tr>
  <tr class="expenses-insight-row-sub"><td>— Bills</td><td class="expenses-col-amount">${f(ins.billsExpenses)}</td></tr>
  <tr class="expenses-insight-row-sub"><td>— Total Passive Income</td><td class="expenses-col-amount">${f(ins.totalPassiveIncome)}</td></tr>
  <tr class="expenses-insight-spacer" aria-hidden="true"><td colspan="2"></td></tr>
  <tr class="expenses-insight-row-key"><td>Money needed in joint account</td><td class="expenses-col-amount">${f(ins.moneyNeededJointAccount)}</td></tr>
  <tr class="expenses-insight-spacer" aria-hidden="true"><td colspan="2"></td></tr>
  <tr class="expenses-insight-section-head"><td colspan="2">Dividend Split</td></tr>
  <tr><td>Heena</td><td class="expenses-col-amount">${divAmount(ins.dividendHeena)}</td></tr>
  <tr><td>David</td><td class="expenses-col-amount">${divAmount(ins.dividendDavid)}</td></tr>
</tbody>`;
}

function buildDebtInsightMarkup(ins: ExpensesInsight): string {
  const f = formatCurrency;
  return `
<tbody>
  <tr class="expenses-insight-section-head"><td colspan="2">Debt</td></tr>
  <tr><td>Short Term Debt</td><td class="expenses-col-amount">${f(ins.debtShortTerm)}</td></tr>
  <tr><td>Medium Term Debt</td><td class="expenses-col-amount">${f(ins.debtMediumTerm)}</td></tr>
  <tr class="expenses-insight-row-bold"><td>Total</td><td class="expenses-col-amount">${f(ins.debtTotal)}</td></tr>
</tbody>`;
}

function renderAnnualSummaryPods(data: ExpensesSheetResponse): void {
  const { summary } = data;
  setText('expenses-annual-pod-out', formatCurrency(summary.totalAnnualOutgoings));
  setText('expenses-annual-pod-in', formatCurrency(summary.totalAnnualIncome));
  const net = summary.netAnnualFixed;
  setText('expenses-annual-pod-net', (net >= 0 ? '+' : '') + formatCurrency(net));
}

function renderMonthlyOutgoings(sections: ExpensesSection[]): void {
  const container = document.getElementById('expenses-monthly-outgoings');
  if (!container) return;

  if (sections.length === 0) {
    container.innerHTML = '<p class="expenses-empty">No recurring monthly outgoings detected in this window. Upload more statements or wait for patterns to emerge.</p>';
    return;
  }

  container.innerHTML = sections.map(section => renderSectionTable(section, '/mo')).join('');
  attachVarianceHandlers(container);
}

function renderAnnualOutgoings(sections: ExpensesSection[]): void {
  const container = document.getElementById('expenses-annual-outgoings');
  if (!container) return;

  const total = sections.reduce((s, sec) => s + sec.subtotal, 0);
  setText('expenses-annual-subtotal', formatCurrency(total));

  if (sections.length === 0) {
    container.innerHTML = '<p class="expenses-empty">No annual recurring outgoings detected.</p>';
    return;
  }

  container.innerHTML = sections.map(section => renderSectionTable(section, '/yr')).join('');
  attachVarianceHandlers(container);
}

function renderAnnualIncome(data: ExpensesSheetResponse): void {
  const container = document.getElementById('expenses-income-annual-table');
  if (!container) return;

  const items = data.incomeAnnual.items;
  setText('expenses-annual-income-subtotal', formatCurrency(data.incomeAnnual.total));

  if (items.length === 0) {
    container.innerHTML = '<p class="expenses-empty">No annual recurring income detected.</p>';
    return;
  }

  renderIncomeTable('expenses-income-annual-table', items, '/yr');
}

function renderIncomeTable(containerId: string, items: ExpensesLineItem[], suffix: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = '<p class="expenses-empty">None detected.</p>';
    return;
  }

  const rows = items.map(item => renderRow(item, suffix)).join('');
  container.innerHTML = `
    <table class="expenses-table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Account</th>
          <th class="expenses-col-amount">Amount</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  attachVarianceHandlers(container);
}

function renderSectionTable(section: ExpensesSection, suffix: string): string {
  const rows = section.items.map(item => renderRow(item, suffix)).join('');
  return `
    <div class="expenses-section-block">
      <h3 class="expenses-section-title">
        <span class="expenses-section-dot" style="background:${section.colour}"></span>
        ${escapeHtml(section.name)}
        <span class="expenses-section-subtotal">${formatCurrency(section.subtotal)}${suffix}</span>
      </h3>
      <table class="expenses-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Account</th>
            <th class="expenses-col-amount">Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderRow(item: ExpensesLineItem, amountSuffix = ''): string {
  const freq = item.frequency === 'annual' ? '/yr' : '/mo';
  const suffix = amountSuffix || freq;
  const variancePayload = encodeURIComponent(JSON.stringify({
    merchant: item.merchant,
    variance: item.variance,
    typical: item.amount,
  }));
  const infoBtn = item.variance.length > 0
    ? `<button type="button" class="expenses-info-btn" data-variance="${variancePayload}" title="Show periods where amount differed">i</button>`
    : '';

  const billing = item.billingDay
    ? `<span class="expenses-billing">${escapeHtml(item.billingDay)}</span>`
    : '';

  return `
    <tr class="expenses-row">
      <td>
        <div class="expenses-item-name">${escapeHtml(item.merchant)}</div>
        ${billing}
      </td>
      <td><span class="expenses-account-pill">${escapeHtml(item.sourceAccount)}</span></td>
      <td class="expenses-col-amount">${formatCurrency(item.amount)}${suffix}</td>
      <td class="expenses-col-info">${infoBtn}</td>
    </tr>
  `;
}

function attachVarianceHandlers(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>('.expenses-info-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const raw = btn.getAttribute('data-variance');
      if (!raw) return;
      try {
        const parsed = JSON.parse(decodeURIComponent(raw)) as {
          merchant: string;
          typical: number;
          variance: Array<{ month: string; expected: number; actual: number }>;
        };
        showVarianceModal(parsed.merchant, parsed.typical, parsed.variance);
      } catch {
        /* ignore */
      }
    });
  });
}

function showVarianceModal(
  merchant: string,
  typical: number,
  variance: Array<{ month: string; expected: number; actual: number }>,
): void {
  const modal = document.getElementById('expenses-variance-modal');
  const titleEl = document.getElementById('expenses-variance-modal-title');
  const bodyEl = document.getElementById('expenses-variance-modal-body');
  if (!modal || !titleEl || !bodyEl) return;

  titleEl.textContent = merchant;
  const rows = variance.map(v => {
    const diff = round2(v.actual - v.expected);
    const diffStr = diff >= 0 ? `+${formatCurrency(diff)}` : formatCurrency(diff);
    return `
      <tr>
        <td>${escapeHtml(v.month)}</td>
        <td>${formatCurrency(v.expected)}</td>
        <td>${formatCurrency(v.actual)}</td>
        <td>${diffStr}</td>
      </tr>
    `;
  }).join('');

  bodyEl.innerHTML = `
    <p class="expenses-variance-intro">Typical amount shown in the sheet: <strong>${formatCurrency(typical)}</strong>. Below are periods where the actual amount differed.</p>
    <table class="expenses-variance-table">
      <thead>
        <tr><th>Period</th><th>Expected</th><th>Actual</th><th>Difference</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  modal.style.display = 'flex';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

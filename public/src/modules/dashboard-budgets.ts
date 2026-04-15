/**
 * Dashboard Budgets panel — read-only vs actual (data from summary).
 */

import type { DashboardSummary } from '../types';
import { escapeHtml } from '../utils/dom';
import { formatCurrency } from '../utils/formatting';

export function renderBudgetDashboardPanel(data: DashboardSummary): void {
  const note = document.getElementById('budget-dashboard-note');
  const body = document.getElementById('budget-dashboard-body');
  const panel = document.getElementById('budget-dashboard-panel');
  if (!note || !body || !panel) return;

  panel.classList.remove('budget-dashboard-panel--has-over');

  if (!data.selectedFinancialYear) {
    note.hidden = false;
    note.textContent = 'Select a financial year to compare budgets.';
    body.innerHTML = '';
    return;
  }

  const rows = data.budgetComparisons ?? [];
  if (rows.length === 0) {
    note.hidden = false;
    note.textContent =
      'No budgets set for this account in this financial year. Use the Budget tab to add budgets.';
    body.innerHTML = '';
    return;
  }

  note.hidden = true;

  const hasOver = rows.some(r => r.overBy > 0);
  if (hasOver) {
    panel.classList.add('budget-dashboard-panel--has-over');
  }

  const tr = rows
    .map(r => {
      const over = r.overBy > 0;
      const rowClass = over
        ? 'budget-dashboard-row budget-dashboard-row--over'
        : 'budget-dashboard-row';
      const warn = over
        ? `<span class="budget-dashboard-warn" aria-hidden="true">!</span> `
        : '';
      const overCell = over
        ? `<span class="budget-dashboard-over-amount">${formatCurrency(r.overBy)} over</span>`
        : formatCurrency(0);
      return `
      <tr class="${rowClass}">
        <td>${warn}${escapeHtml(r.category)}</td>
        <td class="fixed-expenses-col-amount">${formatCurrency(r.budgetAmount)}</td>
        <td class="fixed-expenses-col-amount">${formatCurrency(r.spent)}</td>
        <td class="fixed-expenses-col-amount">${over ? '—' : formatCurrency(r.remaining)}</td>
        <td class="fixed-expenses-col-amount">${over ? overCell : '—'}</td>
      </tr>`;
    })
    .join('');

  body.innerHTML = `
    <div class="fixed-expenses-tables-wrap">
      <table class="fixed-expenses-table budget-dashboard-table">
        <thead>
          <tr>
            <th>Category</th>
            <th class="fixed-expenses-col-amount">Budget</th>
            <th class="fixed-expenses-col-amount">Spent</th>
            <th class="fixed-expenses-col-amount">Remaining</th>
            <th class="fixed-expenses-col-amount">Over</th>
          </tr>
        </thead>
        <tbody>${tr}</tbody>
      </table>
    </div>
  `;
}

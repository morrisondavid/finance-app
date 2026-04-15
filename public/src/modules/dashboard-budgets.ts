/**
 * Dashboard Budgets panel — read-only vs actual (data from summary).
 */

import type { DashboardSummary } from '../types';
import { escapeHtml, escapeAttribute } from '../utils/dom';
import { formatCurrency } from '../utils/formatting';

function rowHasAnyOver(r: { months: { difference: number }[] }): boolean {
  return r.months.some(m => m.difference > 0);
}

function rowClassForDifference(difference: number): string {
  if (difference > 0) return 'budget-dashboard-row budget-dashboard-row--over';
  if (difference < 0) return 'budget-dashboard-row budget-dashboard-row--under';
  return 'budget-dashboard-row budget-dashboard-row--neutral';
}

function categoryTableRows(r: {
  category: string;
  monthlyBudget: number;
  months: {
    monthKey: string;
    monthLabel: string;
    budget: number;
    spent: number;
    difference: number;
  }[];
}): string {
  const anyOver = rowHasAnyOver(r);
  const warn = anyOver ? `<span class="budget-dashboard-warn" aria-hidden="true">!</span> ` : '';
  const cat = escapeHtml(r.category);
  const catAttr = escapeAttribute(r.category);

  if (r.months.length === 0) {
    return `<tr class="budget-dashboard-row budget-dashboard-row--neutral">
        <td>${warn}${cat}</td>
        <td>—</td>
        <td class="budget-dashboard-td-amount">${formatCurrency(r.monthlyBudget)}</td>
        <td class="budget-dashboard-td-amount">—</td>
        <td class="budget-dashboard-td-amount">—</td>
      </tr>`;
  }

  return r.months
    .map((m, i) => {
      const rowClass = rowClassForDifference(m.difference);
      const catCell =
        i === 0
          ? `<td rowspan="${r.months.length}">${warn}${cat}</td>`
          : '';
      const monthLabelEsc = escapeHtml(m.monthLabel);
      const monthLabelAttr = escapeAttribute(m.monthLabel);
      const monthKeyAttr = escapeAttribute(m.monthKey);
      const ariaOpen = escapeAttribute(`View transactions: ${r.category}, ${m.monthLabel}`);
      return `<tr class="${rowClass}" data-budget-month data-budget-category="${catAttr}" data-budget-month-key="${monthKeyAttr}" data-budget-month-label="${monthLabelAttr}" tabindex="0" role="button" aria-label="${ariaOpen}">
        ${catCell}
        <td>${monthLabelEsc}</td>
        <td class="budget-dashboard-td-amount">${formatCurrency(m.budget)}</td>
        <td class="budget-dashboard-td-amount">${formatCurrency(m.spent)}</td>
        <td class="budget-dashboard-td-amount">${formatCurrency(m.difference)}</td>
      </tr>`;
    })
    .join('');
}

export function renderBudgetDashboardPanel(data: DashboardSummary): void {
  const note = document.getElementById('budget-dashboard-note');
  const body = document.getElementById('budget-dashboard-body');
  const panel = document.getElementById('budget-dashboard-panel');
  if (!note || !body || !panel) return;

  panel.classList.remove('budget-dashboard-panel--has-over', 'budget-dashboard-panel--all-clear');

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

  const hasOver = rows.some(rowHasAnyOver);
  const hasAnyMonthRow = rows.some(r => r.months.length > 0);
  if (hasOver) {
    panel.classList.add('budget-dashboard-panel--has-over');
  } else if (hasAnyMonthRow) {
    panel.classList.add('budget-dashboard-panel--all-clear');
  }

  const tbody = rows.map(r => categoryTableRows(r)).join('');

  body.innerHTML = `
    <div class="budget-dashboard-table-scroll">
      <table class="budget-dashboard-budgets-table">
        <colgroup>
          <col class="budget-dashboard-col-category" />
          <col class="budget-dashboard-col-month" />
          <col class="budget-dashboard-col-amount" />
          <col class="budget-dashboard-col-amount" />
          <col class="budget-dashboard-col-amount" />
        </colgroup>
        <thead>
          <tr>
            <th>Category</th>
            <th>Month</th>
            <th class="budget-dashboard-th-amount">Budget</th>
            <th class="budget-dashboard-th-amount">Actual spend</th>
            <th class="budget-dashboard-th-amount">Difference</th>
          </tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

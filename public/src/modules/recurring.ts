/**
 * Recurring Expenses widget – renders floating pods on the dashboard.
 */

import { state } from './state';
import { fetchRecurringExpenses } from '../utils/api';
import type { RecurringExpense } from '../../../shared/api-contracts.js';

export function initRecurring(): void {
  // No persistent listeners needed — account/FY changes already re-trigger loadDashboard
}

function formatAmount(expense: RecurringExpense): string {
  const formatted = `£${expense.amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return expense.frequency === 'monthly' ? `-${formatted}/mo` : `-${formatted}`;
}

function getInitials(merchant: string): string {
  return merchant
    .split(/[\s&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

function buildPodHTML(expense: RecurringExpense, index: number): string {
  const delay = (index * 0.15).toFixed(2);
  const initials = getInitials(expense.merchant);

  const logoImg = expense.logoUrl
    ? `<img class="recurring-pod-logo" src="${expense.logoUrl}" alt="" loading="lazy"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">`
    : '';

  const initialsDiv = expense.logoUrl
    ? `<div class="recurring-pod-initials" style="display:none; background:${expense.colour}">${initials}</div>`
    : `<div class="recurring-pod-initials" style="display:flex; background:${expense.colour}">${initials}</div>`;

  const billingInfo = expense.billingDay ? ` — ${expense.billingDay}` : '';
  const tooltip = `${expense.merchant} — ${expense.category} — ${formatAmount(expense)}${billingInfo}`;

  return `
    <div class="recurring-pod" style="animation-delay:${delay}s" title="${tooltip}">
      ${logoImg}
      ${initialsDiv}
      <div class="recurring-pod-info">
        <span class="recurring-pod-name">${expense.merchant}</span>
        <span class="recurring-pod-amount">${formatAmount(expense)}</span>
        ${expense.billingDay ? `<span class="recurring-pod-date">${expense.billingDay}</span>` : ''}
        <span class="recurring-pod-category"><span class="recurring-pod-cat-dot" style="background:${expense.colour}"></span>${expense.category}</span>
      </div>
    </div>`;
}

function formatTotal(amount: number): string {
  return `£${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderSection(label: string, expenses: RecurringExpense[]): string {
  if (expenses.length === 0) return '';

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const suffix = label === 'Monthly' ? '/mo' : '/yr';

  const pods = expenses.map((e, i) => buildPodHTML(e, i)).join('');
  return `
    <div class="recurring-section">
      <div class="recurring-section-header">
        <span class="recurring-section-label">${label}</span>
        <span class="recurring-section-count">${expenses.length}</span>
        <span class="recurring-section-total">${formatTotal(total)}${suffix}</span>
      </div>
      <div class="recurring-pods">${pods}</div>
    </div>`;
}

export async function loadRecurring(): Promise<void> {
  const panel = document.getElementById('recurring-panel');
  const container = document.getElementById('recurring-sections');
  if (!panel || !container) return;

  try {
    const data = await fetchRecurringExpenses({
      account: state.selectedAccount,
      financialYear: state.selectedFinancialYear || undefined,
    });

    if (data.monthly.length === 0 && data.annual.length === 0) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = '';
    container.innerHTML =
      renderSection('Monthly', data.monthly) +
      renderSection('Annual', data.annual);
  } catch (error) {
    console.error('[Recurring] Error loading recurring expenses:', error);
    if (container) {
      container.innerHTML = '<p class="error">Failed to load recurring expenses.</p>';
    }
  }
}

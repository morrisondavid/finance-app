/**
 * Dashboard Fixed Expenses widget — recurring pods for the selected account.
 */

import { state } from './state';
import { fetchRecurringExpenses } from '../utils/api';
import { formatCurrency, formatBillingDay } from '../utils/formatting';
import { escapeHtml, escapeAttribute } from '../utils/dom';
import type { RecurringExpense } from '../../../shared/api-contracts.js';

export function initRecurring(): void {
  // No persistent listeners needed — account/FY changes already re-trigger loadDashboard
}

function formatAmount(expense: RecurringExpense): string {
  const formatted = formatCurrency(expense.amount);
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
    ? `<img class="recurring-pod-logo" src="${escapeAttribute(expense.logoUrl)}" alt="" loading="lazy"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">`
    : '';

  const safeColour = escapeAttribute(expense.colour);
  const initialsDiv = expense.logoUrl
    ? `<div class="recurring-pod-initials" style="display:none; background:${safeColour}">${escapeHtml(initials)}</div>`
    : `<div class="recurring-pod-initials" style="display:flex; background:${safeColour}">${escapeHtml(initials)}</div>`;

  const billingLabel = formatBillingDay(expense.billingDayOfMonth, expense.billingMonth, expense.frequency);
  const billingInfo = billingLabel ? ` — ${billingLabel}` : '';
  const tooltip = `${expense.merchant} — ${expense.category} — ${formatAmount(expense)}${billingInfo}`;

  return `
    <div class="recurring-pod" style="animation-delay:${delay}s" title="${escapeAttribute(tooltip)}">
      ${logoImg}
      ${initialsDiv}
      <div class="recurring-pod-info">
        <span class="recurring-pod-name">${escapeHtml(expense.merchant)}</span>
        <span class="recurring-pod-amount">${escapeHtml(formatAmount(expense))}</span>
        ${billingLabel ? `<span class="recurring-pod-date">${escapeHtml(billingLabel)}</span>` : ''}
        <span class="recurring-pod-category"><span class="recurring-pod-cat-dot" style="background:${safeColour}"></span>${escapeHtml(expense.category)}</span>
      </div>
    </div>`;
}

function formatTotal(amount: number): string {
  return formatCurrency(amount);
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

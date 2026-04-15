/**
 * Renders the budget nudge panel on the dashboard — shows high-spend merchants
 * that aren't covered by a budget, with a CTA to create one.
 */

import type { DashboardSummary } from '../types';
import type { BudgetNudge } from '../../../shared/api-contracts.js';
import { escapeHtml, escapeAttribute } from '../utils/dom';
import { formatCurrency } from '../utils/formatting';
import { showMerchantTransactionsModal } from './dashboard-modals';
import { loadAdHocExpenses } from './ad-hoc-expenses';
import { activateTabByName } from './tabs';

const AD_HOC_CHART_ICON = `<svg class="budget-nudge-adhoc-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 6-7"/></svg>`;

function nudgeCard(n: BudgetNudge): string {
  const logoImg = n.logoUrl
    ? `<img class="budget-nudge-logo" src="${escapeAttribute(n.logoUrl)}" alt="" width="32" height="32" loading="lazy" />`
    : `<span class="budget-nudge-logo budget-nudge-logo--placeholder" aria-hidden="true"></span>`;

  const metaText = `${n.transactionCount} txns · ${n.suggestedCategory}`;

  return `
    <div class="budget-nudge-card" data-nudge-merchant="${escapeAttribute(n.merchant)}">
      <div class="budget-nudge-card-body">
        <div class="budget-nudge-card-main">
          ${logoImg}
          <div class="budget-nudge-card-info">
            <span class="budget-nudge-merchant" title="${escapeAttribute(n.merchant)}">${escapeHtml(n.merchant)}</span>
            <span class="budget-nudge-meta" title="${escapeAttribute(metaText)}">${n.transactionCount} txns &middot; ${escapeHtml(n.suggestedCategory)}</span>
          </div>
        </div>
        <div class="budget-nudge-total-line">
          <span class="budget-nudge-total">${formatCurrency(n.totalSpend)}</span>
        </div>
      </div>
      <div class="budget-nudge-card-footer">
        <a href="#" class="budget-nudge-link budget-nudge-cta" data-nudge-category="${escapeAttribute(n.suggestedCategory)}">Add budget &rarr;</a>
        <button type="button" class="budget-nudge-adhoc-chart-btn" aria-label="Open Ad hoc expenses to analyse spend over time for ${escapeAttribute(n.merchant)}">
          ${AD_HOC_CHART_ICON}
        </button>
      </div>
    </div>
  `;
}

export function renderBudgetNudgesPanel(data: DashboardSummary): void {
  const panel = document.getElementById('budget-nudges-panel');
  if (!panel) return;

  const nudges = data.budgetNudges ?? [];

  if (nudges.length === 0) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }

  panel.hidden = false;
  panel.innerHTML = `
    <h2 class="budget-nudge-heading">High-spend merchants without a budget</h2>
    <p class="budget-nudge-subtitle">You might want to set a monthly budget for these.</p>
    <div class="budget-nudge-cards">${nudges.map(nudgeCard).join('')}</div>
  `;
}

export function initBudgetNudgeInteractions(): void {
  const panel = document.getElementById('budget-nudges-panel');
  if (!panel) return;

  panel.addEventListener('click', (e) => {
    const raw = e.target;
    const origin =
      raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null;
    if (!origin) return;

    const adHocBtn = origin.closest('button.budget-nudge-adhoc-chart-btn');
    if (adHocBtn instanceof HTMLButtonElement) {
      e.preventDefault();
      e.stopPropagation();
      void openAdHocExpensesTab();
      return;
    }

    const addLink = origin.closest('a.budget-nudge-cta');
    if (addLink instanceof HTMLAnchorElement) {
      e.preventDefault();
      const category = addLink.dataset.nudgeCategory;
      if (category) void activateTabAndPreselectCategory(category);
      return;
    }

    const card = origin.closest('.budget-nudge-card');
    if (card instanceof HTMLElement) {
      const merchant = card.dataset.nudgeMerchant;
      if (merchant) void showMerchantTransactionsModal(merchant);
    }
  });
}

async function openAdHocExpensesTab(): Promise<void> {
  activateTabByName('ad-hoc-expenses');
  await loadAdHocExpenses();
  document.getElementById('ad-hoc-merchant-chart-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function activateTabAndPreselectCategory(category: string): Promise<void> {
  activateTabByName('budget');
  const periodSel = document.getElementById('budget-period-select');
  if (periodSel instanceof HTMLSelectElement) periodSel.value = 'monthly';
  const { loadBudgetSheet } = await import('./budget-sheet.js');
  await loadBudgetSheet();
  const catSel = document.getElementById('budget-category-select');
  if (catSel instanceof HTMLSelectElement) catSel.value = category;
  const amtInput = document.getElementById('budget-amount-input');
  if (amtInput instanceof HTMLInputElement) amtInput.focus();
}

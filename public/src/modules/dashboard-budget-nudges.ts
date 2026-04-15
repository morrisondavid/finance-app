/**
 * Renders the budget nudge panel on the dashboard — shows high-spend merchants
 * that aren't covered by a budget, with a CTA to create one.
 */

import type { DashboardSummary } from '../types';
import type { BudgetNudge } from '../../../shared/api-contracts.js';
import { escapeHtml, escapeAttribute } from '../utils/dom';
import { formatCurrency } from '../utils/formatting';
import { showMerchantTransactionsModal } from './dashboard-modals';

function nudgeCard(n: BudgetNudge): string {
  const logoImg = n.logoUrl
    ? `<img class="budget-nudge-logo" src="${escapeAttribute(n.logoUrl)}" alt="" width="32" height="32" loading="lazy" />`
    : `<span class="budget-nudge-logo budget-nudge-logo--placeholder" aria-hidden="true"></span>`;

  return `
    <div class="budget-nudge-card" data-nudge-merchant="${escapeAttribute(n.merchant)}">
      <div class="budget-nudge-card-body">
        <div class="budget-nudge-card-main">
          ${logoImg}
          <div class="budget-nudge-card-info">
            <span class="budget-nudge-merchant">${escapeHtml(n.merchant)}</span>
            <span class="budget-nudge-meta">${n.transactionCount} txns &middot; ${escapeHtml(n.suggestedCategory)}</span>
          </div>
        </div>
        <span class="budget-nudge-total">${formatCurrency(n.totalSpend)}</span>
      </div>
      <a href="#" class="budget-nudge-link budget-nudge-cta" data-nudge-category="${escapeAttribute(n.suggestedCategory)}">Add budget &rarr;</a>
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
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const addLink = target.closest<HTMLElement>('.budget-nudge-cta');
    if (addLink) {
      e.preventDefault();
      const category = addLink.dataset.nudgeCategory;
      if (category) void activateTabAndPreselectCategory(category);
      return;
    }

    const card = target.closest<HTMLElement>('.budget-nudge-card');
    if (card) {
      const merchant = card.dataset.nudgeMerchant;
      if (merchant) void showMerchantTransactionsModal(merchant);
    }
  });
}

async function activateTabAndPreselectCategory(category: string): Promise<void> {
  const tabBtn = document.querySelector<HTMLElement>('[data-tab="budget"]');
  if (tabBtn) tabBtn.click();
  const periodSel = document.getElementById('budget-period-select');
  if (periodSel instanceof HTMLSelectElement) periodSel.value = 'monthly';
  const { loadBudgetSheet } = await import('./budget-sheet.js');
  await loadBudgetSheet();
  const catSel = document.getElementById('budget-category-select');
  if (catSel instanceof HTMLSelectElement) catSel.value = category;
  const amtInput = document.getElementById('budget-amount-input');
  if (amtInput instanceof HTMLInputElement) amtInput.focus();
}

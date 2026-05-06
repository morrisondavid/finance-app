/**
 * Budget tab — CRUD for category budgets (CSV-backed on server).
 * One row per (account, category): monthly cap or full FY cap per period.
 */

import { state } from './state';
import { getAccountConfig } from './state';
import {
  fetchBudgetCategoryNames,
  fetchBudgetsList,
  createBudget,
  deleteBudget,
} from '../utils/api';
import { formatCurrency, currencySymbol } from '../utils/formatting';
import { escapeHtml } from '../utils/dom';
import { getSelectedCurrency } from './state';
import { loadDashboard } from './dashboard';
import { loadLiquidityDashboard } from './liquidity-dashboard';
import { eligibleCategoriesForPeriod } from './budget-sheet-utils';
import {
  isQoLCategory,
  isMandatoryCategory,
} from '../../../shared/expenses-insight';
import type { BudgetPeriod, BudgetRow } from '../../../shared/api-contracts.js';

/**
 * §1.9 — render a small pill next to budgetable categories so the
 * user can see at a glance whether the planner treats them as
 * inviolable (QoL) or adjustable (Malleable). Mandatory categories
 * get no pill (they're a separate class entirely).
 */
function qolPillForCategory(category: string): string {
  if (isMandatoryCategory(category)) return '';
  if (isQoLCategory(category)) {
    return ` <span class="budget-qol-pill budget-qol-pill--qol" title="Inviolable lifestyle floor — the §1.9 Debt Strategy planner never proposes cutting this">QoL</span>`;
  }
  return ` <span class="budget-qol-pill budget-qol-pill--malleable" title="Malleable — the §1.9 Debt Strategy planner can propose cuts here when activating a plan">Malleable</span>`;
}

let wired = false;
/** All category names (same for every account). */
let cachedAllCategories: string[] | null = null;
let lastBudgetsList: BudgetRow[] = [];

export function initBudgetSheet(): void {
  if (wired) return;
  wired = true;

  const addBtn = document.getElementById('budget-add-btn');
  addBtn?.addEventListener('click', () => {
    void submitBudget();
  });

  const periodSel = document.getElementById('budget-period-select');
  if (periodSel instanceof HTMLSelectElement) {
    periodSel.addEventListener('change', () => {
      updatePeriodHint();
      void rebuildCategorySelect(lastBudgetsList);
    });
  }
}

async function ensureAllCategories(): Promise<string[]> {
  if (cachedAllCategories && cachedAllCategories.length > 0) {
    return cachedAllCategories;
  }
  const { categories } = await fetchBudgetCategoryNames();
  cachedAllCategories = categories;
  return categories;
}

function updatePeriodHint(): void {
  const periodSel = document.getElementById('budget-period-select');
  const hint = document.getElementById('budget-period-hint');
  if (!(periodSel instanceof HTMLSelectElement) || !hint) return;
  hint.textContent =
    periodSel.value === 'yearly'
      ? 'Yearly amount is your total cap for the selected financial year (dashboard compares to spend in that FY).'
      : 'Monthly amount is compared month by month on the dashboard for the selected financial year.';
}

async function rebuildCategorySelect(budgets: readonly BudgetRow[]): Promise<void> {
  const sel = document.getElementById('budget-category-select');
  const periodSel = document.getElementById('budget-period-select');
  if (!(sel instanceof HTMLSelectElement) || !(periodSel instanceof HTMLSelectElement)) return;
  const period: BudgetPeriod = periodSel.value === 'yearly' ? 'yearly' : 'monthly';
  const all = await ensureAllCategories();
  const eligible = eligibleCategoriesForPeriod(all, budgets, period);
  const prev = sel.value;
  sel.innerHTML = eligible.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (eligible.includes(prev)) sel.value = prev;
}

async function submitBudget(): Promise<void> {
  const catSel = document.getElementById('budget-category-select');
  const amtEl = document.getElementById('budget-amount-input');
  const periodSel = document.getElementById('budget-period-select');
  if (
    !(catSel instanceof HTMLSelectElement) ||
    !(amtEl instanceof HTMLInputElement) ||
    !(periodSel instanceof HTMLSelectElement)
  ) {
    return;
  }
  const category = catSel.value;
  const amount = Number(amtEl.value);
  const period: BudgetPeriod = periodSel.value === 'yearly' ? 'yearly' : 'monthly';
  if (!Number.isFinite(amount) || amount < 0) {
    alert('Enter a valid amount (0 or more).');
    return;
  }
  try {
    await createBudget({
      account: state.selectedAccount,
      category,
      amount,
      period,
    });
    amtEl.value = '';
    await loadBudgetSheet();
    void loadLiquidityDashboard();
    await loadDashboard();
  } catch (e) {
    console.error('[Budget] save', e);
    alert('Could not save budget. Check the console.');
  }
}

export async function loadBudgetSheet(): Promise<void> {
  const wrap = document.getElementById('budget-table-wrap');
  const meta = document.getElementById('budget-tab-meta');
  if (!wrap || !meta) return;

  await ensureAllCategories();
  updatePeriodHint();

  const cfg = getAccountConfig(state.selectedAccount);
  const accountLabel = cfg?.label ?? state.selectedAccount;

  meta.textContent = `Account: ${accountLabel}`;
  wrap.innerHTML = '<p class="ad-hoc-expenses-empty">Loading…</p>';

  try {
    const { budgets } = await fetchBudgetsList({
      account: state.selectedAccount,
    });
    lastBudgetsList = budgets;
    await rebuildCategorySelect(budgets);

    if (budgets.length === 0) {
      wrap.innerHTML = '<p class="ad-hoc-expenses-empty">No budgets yet. Add one above.</p>';
      return;
    }
    const rows = budgets
      .map(b => {
        const fyCap =
          b.period === 'monthly' ? Math.round(b.amount * 12 * 100) / 100 : null;
        const fyCol =
          fyCap !== null ? formatCurrency(fyCap) : '—';
        const periodLabel = b.period === 'yearly' ? 'Yearly' : 'Monthly';
        const qolPill = qolPillForCategory(b.category);
        return `
      <tr>
        <td>${escapeHtml(b.account)}</td>
        <td>${escapeHtml(b.category)}${qolPill}</td>
        <td>${escapeHtml(periodLabel)}</td>
        <td class="ad-hoc-expenses-col-num">${formatCurrency(b.amount)}</td>
        <td class="ad-hoc-expenses-col-num">${fyCol}</td>
        <td class="ad-hoc-expenses-col-num">
          <button type="button" class="btn-small budget-delete-btn" data-id="${b.id}">Delete</button>
        </td>
      </tr>`;
      })
      .join('');
    wrap.innerHTML = `
      <table class="ad-hoc-expenses-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Category</th>
            <th>Period</th>
            <th>Cap (${currencySymbol(getSelectedCurrency())})</th>
            <th>FY implied (12× monthly)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    wrap.querySelectorAll<HTMLButtonElement>('.budget-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        if (!Number.isInteger(id)) return;
        if (!confirm('Delete this budget?')) return;
        try {
          await deleteBudget(id);
          await loadBudgetSheet();
          void loadLiquidityDashboard();
          await loadDashboard();
        } catch (err) {
          console.error('[Budget] delete', err);
          alert('Delete failed.');
        }
      });
    });
  } catch (e) {
    console.error('[Budget] load', e);
    wrap.innerHTML = '<p class="ad-hoc-expenses-error">Failed to load budgets.</p>';
  }
}

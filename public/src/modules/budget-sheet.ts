/**
 * Budget tab — CRUD for category budgets (CSV-backed on server).
 * Account and FY selectors are shared with the dashboard module (`initDashboard`).
 */

import { state } from './state';
import { getAccountConfig } from './state';
import {
  fetchBudgetCategoryNames,
  fetchBudgetsList,
  createBudget,
  deleteBudget,
} from '../utils/api';
import { formatCurrency } from '../utils/formatting';
import { escapeHtml } from '../utils/dom';
import { loadDashboard } from './dashboard';

let wired = false;

export function initBudgetSheet(): void {
  if (wired) return;
  wired = true;

  const addBtn = document.getElementById('budget-add-btn');
  addBtn?.addEventListener('click', () => {
    void submitBudget();
  });
}

async function ensureCategoryOptions(): Promise<void> {
  const sel = document.getElementById('budget-category-select');
  if (!(sel instanceof HTMLSelectElement) || sel.options.length > 0) return;
  try {
    const { categories } = await fetchBudgetCategoryNames();
    sel.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  } catch (e) {
    console.error('[Budget] category names', e);
  }
}

async function submitBudget(): Promise<void> {
  const fy = state.selectedFinancialYear?.trim();
  if (!fy) {
    alert('Select a financial year before adding a budget.');
    return;
  }
  const catSel = document.getElementById('budget-category-select');
  const amtEl = document.getElementById('budget-amount-input');
  if (!(catSel instanceof HTMLSelectElement) || !(amtEl instanceof HTMLInputElement)) return;
  const category = catSel.value;
  const amount = Number(amtEl.value);
  if (!Number.isFinite(amount) || amount < 0) {
    alert('Enter a valid budget amount (0 or more).');
    return;
  }
  try {
    await createBudget({
      account: state.selectedAccount,
      category,
      financialYear: fy,
      amount,
    });
    amtEl.value = '';
    await loadBudgetSheet();
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

  await ensureCategoryOptions();

  const fy = state.selectedFinancialYear?.trim();
  const cfg = getAccountConfig(state.selectedAccount);
  const accountLabel = cfg?.label ?? state.selectedAccount;

  if (!fy) {
    meta.textContent = `Account: ${accountLabel} · Select a financial year to view and edit budgets.`;
    wrap.innerHTML = '';
    return;
  }

  meta.textContent = `Account: ${accountLabel} · Financial year ${fy}.`;
  wrap.innerHTML = '<p class="ad-hoc-expenses-empty">Loading…</p>';

  try {
    const { budgets } = await fetchBudgetsList({
      account: state.selectedAccount,
      financialYear: fy,
    });
    if (budgets.length === 0) {
      wrap.innerHTML = '<p class="ad-hoc-expenses-empty">No budgets yet. Add one above.</p>';
      return;
    }
    const rows = budgets
      .map(
        b => `
      <tr>
        <td>${escapeHtml(b.financialYear)}</td>
        <td>${escapeHtml(b.account)}</td>
        <td>${escapeHtml(b.category)}</td>
        <td class="ad-hoc-expenses-col-num">${formatCurrency(b.amount)}</td>
        <td class="ad-hoc-expenses-col-num">
          <button type="button" class="btn-small budget-delete-btn" data-id="${b.id}">Delete</button>
        </td>
      </tr>`,
      )
      .join('');
    wrap.innerHTML = `
      <table class="ad-hoc-expenses-table">
        <thead>
          <tr>
            <th>Financial year</th>
            <th>Account</th>
            <th>Category</th>
            <th>Budget</th>
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

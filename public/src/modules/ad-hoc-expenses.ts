/**
 * Ad hoc expenses — non–fixed-recurring spend for one account (rolling window).
 * Account is the global dashboard account (same `.account-selector` as the dashboard).
 */

import { fetchAdHocExpenses } from '../utils/api';
import { escapeHtml } from '../utils/dom';
import { formatCurrency, formatIsoDateUk } from '../utils/formatting';
import { getAccountConfig, getState } from './state';

function financialYearQueryParam(): string | undefined {
  const fy = getState('selectedFinancialYear');
  return fy.trim() !== '' ? fy : undefined;
}

let wired = false;

function readPositiveInt(input: HTMLInputElement, fallback: number, max: number): number {
  const n = Math.floor(Number(input.value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function readNonNegativeInt(input: HTMLInputElement, fallback: number): number {
  const n = Math.floor(Number(input.value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function initAdHocExpenses(): void {
  if (wired) return;
  wired = true;

  const minEl = document.getElementById('ad-hoc-expenses-min');
  const limitEl = document.getElementById('ad-hoc-expenses-limit');
  const refresh = document.getElementById('ad-hoc-expenses-refresh');

  if (!(minEl instanceof HTMLInputElement)) return;
  if (!(limitEl instanceof HTMLInputElement)) return;
  if (!(refresh instanceof HTMLButtonElement)) return;

  refresh.addEventListener('click', () => {
    void loadAdHocExpenses();
  });
}

export async function loadAdHocExpenses(): Promise<void> {
  const minEl = document.getElementById('ad-hoc-expenses-min');
  const limitEl = document.getElementById('ad-hoc-expenses-limit');
  const meta = document.getElementById('ad-hoc-expenses-meta');
  const wrap = document.getElementById('ad-hoc-expenses-table-wrap');

  if (!(minEl instanceof HTMLInputElement)) return;
  if (!(limitEl instanceof HTMLInputElement)) return;
  if (!meta || !wrap) return;

  const account = getState('selectedAccount');
  const accountLabel = getAccountConfig(account).label;
  const minTotal = readNonNegativeInt(minEl, 200);
  const limit = readPositiveInt(limitEl, 25, 100);
  const financialYear = financialYearQueryParam();

  meta.textContent = 'Loading…';
  wrap.innerHTML = '';

  try {
    const data = await fetchAdHocExpenses({
      account,
      ...(financialYear !== undefined ? { financialYear } : {}),
      min: minTotal,
      limit,
    });
    meta.textContent = `Account: ${accountLabel} · ${data.periodDescription} · ${data.items.length} row(s) (min £${data.minTotal}, max ${data.limit} rows).`;

    if (data.items.length === 0) {
      wrap.innerHTML = '<p class="ad-hoc-expenses-empty">No groups matched. Try another financial year, lowering the minimum total, or raising the row limit.</p>';
      return;
    }

    const rows = data.items
      .map(
        item => `
      <tr>
        <td>${escapeHtml(item.category)}</td>
        <td class="ad-hoc-expenses-col-merchant">${escapeHtml(item.merchant)}</td>
        <td class="ad-hoc-expenses-col-num">${formatCurrency(item.total)}</td>
        <td class="ad-hoc-expenses-col-num">${item.count}</td>
        <td class="ad-hoc-expenses-col-num">${escapeHtml(formatIsoDateUk(item.lastDate))}</td>
        <td class="ad-hoc-expenses-col-sample">${escapeHtml(item.sampleDescription)}</td>
      </tr>`,
      )
      .join('');

    wrap.innerHTML = `
      <table class="ad-hoc-expenses-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Merchant</th>
            <th>Total</th>
            <th>Count</th>
            <th>Last date</th>
            <th>Sample description</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (error) {
    console.error('[Ad hoc expenses] Error loading data:', error);
    meta.textContent = '';
    wrap.innerHTML = '<p class="ad-hoc-expenses-error">Failed to load ad hoc expenses. Check the account and try again.</p>';
  }
}

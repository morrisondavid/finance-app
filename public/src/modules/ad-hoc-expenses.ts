/**
 * Ad hoc expenses — non–fixed-recurring spend for one account (rolling window).
 * Account is the global dashboard account (same `.account-selector` as the dashboard).
 */

import { fetchAdHocExpenses, fetchAdHocMerchantSeries } from '../utils/api';
import { escapeAttribute, escapeHtml } from '../utils/dom';
import { formatCurrency, formatIsoDateUk } from '../utils/formatting';
import { getAccountConfig, getState } from './state';
import {
  destroyAdHocMerchantChart,
  renderAdHocMerchantLineChart,
  resetAdHocMerchantChartPanel,
} from './ad-hoc-expenses-chart';

function financialYearQueryParam(): string | undefined {
  const fy = getState('selectedFinancialYear');
  return fy.trim() !== '' ? fy : undefined;
}

let wired = false;

/** Inline SVG: simple upward trend / line chart affordance (not bars). */
const CHART_ICON_SVG = `<svg class="ad-hoc-expenses-chart-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 6-7"/></svg>`;

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

async function loadAdHocMerchantSeriesForBucket(bucketKey: string): Promise<void> {
  const emptyEl = document.getElementById('ad-hoc-merchant-chart-empty');
  const canvasWrap = document.getElementById('ad-hoc-merchant-chart-canvas-wrap');

  try {
    destroyAdHocMerchantChart();
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = 'Loading chart…';
    }
    if (canvasWrap) canvasWrap.hidden = true;

    const account = getState('selectedAccount');
    const data = await fetchAdHocMerchantSeries({
      account,
      ...(financialYearQueryParam() !== undefined ? { financialYear: financialYearQueryParam() } : {}),
      bucketKey,
    });
    renderAdHocMerchantLineChart(data);
    document.getElementById('ad-hoc-merchant-chart-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    console.error('[Ad hoc expenses] Chart load failed:', error);
    destroyAdHocMerchantChart();
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = 'Could not load chart. Check the connection and try again.';
    }
    if (canvasWrap) canvasWrap.hidden = true;
  }
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

  const section = document.getElementById('ad-hoc-expenses');
  section?.addEventListener('click', (e) => {
    const el = e.target;
    if (!(el instanceof Element)) return;
    const btn = el.closest('button.ad-hoc-expenses-chart-btn');
    if (!(btn instanceof HTMLButtonElement)) return;
    e.preventDefault();
    e.stopPropagation();
    const bucketKey = btn.dataset.bucketKey;
    if (!bucketKey) return;
    void loadAdHocMerchantSeriesForBucket(bucketKey);
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
  resetAdHocMerchantChartPanel();

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
        <td class="ad-hoc-expenses-col-chart">
          <button type="button" class="ad-hoc-expenses-chart-btn" data-bucket-key="${escapeAttribute(item.bucketKey)}" aria-label="View spend over time for ${escapeAttribute(item.merchant)}">
            ${CHART_ICON_SVG}
          </button>
        </td>
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
            <th scope="col" class="ad-hoc-expenses-col-chart" title="Monthly spend chart">Trend</th>
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

/**
 * Dashboard chart rendering — monthly bar chart, category doughnut, and monthly table.
 */

import { Chart } from 'chart.js/auto';
import type { MonthlySummary } from '../types';
import { state, setState, getSelectedCurrency } from './state';
import { fetchCategories } from '../utils/api';
import { formatCurrency, currencySymbol } from '../utils/formatting';
import { showTransactionsModal, showCategoryTransactionsModal } from './dashboard-modals';

let currentMonthlyData: MonthlySummary[] = [];
let categoryChart: Chart | null = null;
let currentVisibleCategories: string[] = [];

export function renderMonthlyChart(monthlyData: MonthlySummary[]): void {
  const ctx = document.getElementById('monthly-chart') as HTMLCanvasElement;
  if (!ctx) return;

  currentMonthlyData = monthlyData;

  if (state.monthlyChart) {
    state.monthlyChart.destroy();
  }

  const labels = monthlyData.map(m => {
    const [year, month] = m.month.split('-');
    return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-GB', {
      month: 'short',
      year: '2-digit'
    });
  });

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Income',
          data: monthlyData.map(m => m.income),
          backgroundColor: 'rgba(16, 185, 129, 0.8)',
          borderRadius: 4
        },
        {
          label: 'Outgoings',
          data: monthlyData.map(m => m.expenses),
          backgroundColor: 'rgba(239, 68, 68, 0.8)',
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_event, elements) => {
        if (elements && elements.length > 0) {
          const element = elements[0];
          const datasetIndex = element.datasetIndex;
          const index = element.index;
          const monthData = currentMonthlyData[index];
          const type = datasetIndex === 0 ? 'income' : 'expense';
          showTransactionsModal(monthData.month, type);
        }
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (context: unknown) => {
              const tip = context as { raw: number; dataset: { label?: string } };
              const sym = currencySymbol(getSelectedCurrency());
              return `${tip.dataset.label}: ${sym}${tip.raw.toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value: unknown) => currencySymbol(getSelectedCurrency()) + (value as number).toLocaleString()
          }
        }
      },
      onHover: (event: unknown, elements: unknown) => {
        const evt = event as { native?: { target?: HTMLElement } };
        const elems = elements as unknown[];
        const target = evt.native?.target;
        if (target) {
          target.style.cursor = (elems && elems.length > 0) ? 'pointer' : 'default';
        }
      }
    }
  });

  setState('monthlyChart', chart);
}

export async function renderCategoryChart(): Promise<void> {
  const ctx = document.getElementById('category-chart') as HTMLCanvasElement;
  const legendEl = document.getElementById('category-legend');
  if (!ctx) return;

  if (categoryChart) {
    categoryChart.destroy();
    categoryChart = null;
  }

  try {
    const data = await fetchCategories({
      account: state.selectedAccount,
      financialYear: state.selectedFinancialYear || undefined,
    });

    if (!data.categories.length || data.totalExpenses === 0) {
      if (legendEl) legendEl.innerHTML = '<p class="empty-state">No expense data available.</p>';
      return;
    }

    // Show every non-zero spend category as its own slice (API returns them
    // sorted by descending total). The real 'Other' classification bucket
    // still appears naturally if it has spend — we no longer fold small
    // categories into a synthetic 'Other', which previously hid ~10 real
    // categories (e.g. Eating Out at ~1.4%) behind an opaque label.
    const visible = data.categories;

    currentVisibleCategories = visible.map(c => c.name);

    categoryChart = new Chart(ctx, {
      type: 'doughnut' as const,
      data: {
        labels: visible.map(c => c.name),
        datasets: [{
          data: visible.map(c => c.total),
          backgroundColor: visible.map(c => c.colour),
          borderWidth: 2,
          borderColor: '#ffffff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        onClick(_event, elements) {
          if (elements.length > 0) {
            const idx = elements[0].index;
            const categoryName = currentVisibleCategories[idx];
            if (categoryName) {
              showCategoryTransactionsModal(categoryName);
            }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context: unknown) => {
                const tip = context as { label: string; raw: number };
                const cat = visible.find(c => c.name === tip.label);
                const cur = getSelectedCurrency();
                return `${tip.label}: ${formatCurrency(tip.raw, cur)} (${cat?.percentage ?? 0}%)`;
              },
            },
          },
        },
      } as import('chart.js').ChartOptions<'doughnut'>,
      plugins: [{
        id: 'centerText',
        afterDraw(chart: Chart) {
          const { ctx: drawCtx, chartArea } = chart;
          if (!drawCtx || !chartArea) return;

          const centerX = (chartArea.left + chartArea.right) / 2;
          const centerY = (chartArea.top + chartArea.bottom) / 2;

          drawCtx.save();
          drawCtx.textAlign = 'center';
          drawCtx.textBaseline = 'middle';

          drawCtx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
          drawCtx.fillStyle = '#64748b';
          drawCtx.fillText('Total Spend', centerX, centerY - 12);

          drawCtx.font = '700 18px -apple-system, BlinkMacSystemFont, sans-serif';
          drawCtx.fillStyle = '#1e293b';
          drawCtx.fillText(formatCurrency(data.totalExpenses, getSelectedCurrency()), centerX, centerY + 10);

          drawCtx.restore();
        },
      }],
    });

    if (legendEl) {
      legendEl.innerHTML = visible
        .map(c => `
          <div class="category-legend-item" role="button" tabindex="0" data-category="${c.name}">
            <span class="category-swatch" style="background:${c.colour}"></span>
            <span class="category-name">${c.name}</span>
            <span class="category-amount">${formatCurrency(c.total, getSelectedCurrency())}</span>
            <span class="category-pct">${c.percentage}%</span>
          </div>
        `)
        .join('');

      // Delegated click/keyboard handler: parity with the donut slice onClick
      // above. Using `.onclick` / `.onkeydown` (not addEventListener) so
      // repeated renderCategoryChart() calls overwrite rather than accumulate.
      const openCategory = (target: EventTarget | null): void => {
        const item = (target as HTMLElement | null)?.closest<HTMLElement>('.category-legend-item');
        const name = item?.dataset.category;
        if (name) showCategoryTransactionsModal(name);
      };
      legendEl.onclick = (ev) => openCategory(ev.target);
      legendEl.onkeydown = (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openCategory(ev.target);
        }
      };
    }
  } catch (error) {
    console.error('[Dashboard] Error loading categories:', error);
    if (legendEl) legendEl.innerHTML = '<p class="empty-state">Failed to load category data.</p>';
  }
}

export function renderMonthlyTable(monthlyData: MonthlySummary[]): void {
  const container = document.getElementById('monthly-table');
  if (!container) return;

  if (monthlyData.length === 0) {
    container.innerHTML = '<p class="empty-state">No transaction data available. Add CSV statements to see summaries.</p>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Month</th>
          <th>Income</th>
          <th>Outgoings</th>
          <th>Net</th>
          <th>VAT</th>
        </tr>
      </thead>
      <tbody>
        ${monthlyData.map(m => {
          const cur = getSelectedCurrency();
          const [y, mo] = m.month.split('-');
          const label = new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
          return `
          <tr>
            <td>${label}</td>
            <td class="income">${formatCurrency(m.income, cur)}</td>
            <td class="expense">${formatCurrency(m.expenses, cur)}</td>
            <td class="${m.net >= 0 ? 'income' : 'expense'}">${formatCurrency(m.net, cur)}</td>
            <td>${formatCurrency(m.vat, cur)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

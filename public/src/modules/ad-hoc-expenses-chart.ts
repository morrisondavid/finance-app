/**
 * Line chart for monthly spend on one ad-hoc merchant bucket (Chart.js).
 */

import { Chart } from 'chart.js/auto';
import type { AdHocMerchantSeriesResponse } from '../../../shared/api-contracts.js';

let currentChart: Chart<'line'> | null = null;

export function destroyAdHocMerchantChart(): void {
  currentChart?.destroy();
  currentChart = null;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return ym;
  return new Date(year, month - 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

export function renderAdHocMerchantLineChart(data: AdHocMerchantSeriesResponse): void {
  const canvas = document.getElementById('ad-hoc-merchant-chart') as HTMLCanvasElement | null;
  const titleEl = document.getElementById('ad-hoc-merchant-chart-title');
  const emptyEl = document.getElementById('ad-hoc-merchant-chart-empty');
  const canvasWrap = document.getElementById('ad-hoc-merchant-chart-canvas-wrap');

  if (!canvas || !titleEl || !emptyEl || !canvasWrap) return;

  destroyAdHocMerchantChart();

  titleEl.textContent = `${data.merchant} — spend by month (${data.periodDescription})`;

  if (data.points.length === 0) {
    emptyEl.textContent = 'No expense transactions in this period for this group.';
    emptyEl.hidden = false;
    canvasWrap.hidden = true;
    return;
  }

  emptyEl.hidden = true;
  canvasWrap.hidden = false;

  const labels = data.points.map(p => monthLabel(p.month));
  const totals = data.points.map(p => p.total);
  const counts = data.points.map(p => p.count);

  currentChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Spend (£)',
          data: totals,
          borderColor: 'rgba(239, 68, 68, 0.95)',
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          fill: true,
          tension: 0.25,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom' },
        tooltip: {
          callbacks: {
            afterLabel: ctx => {
              const i = ctx.dataIndex;
              const c = counts[i];
              return c !== undefined ? `${c} transaction${c === 1 ? '' : 's'}` : '';
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value: string | number) =>
              typeof value === 'number' ? `£${value.toLocaleString('en-GB')}` : value,
          },
        },
      },
    },
  });
}

export function resetAdHocMerchantChartPanel(): void {
  destroyAdHocMerchantChart();
  const titleEl = document.getElementById('ad-hoc-merchant-chart-title');
  const emptyEl = document.getElementById('ad-hoc-merchant-chart-empty');
  const canvasWrap = document.getElementById('ad-hoc-merchant-chart-canvas-wrap');
  if (titleEl) titleEl.textContent = 'Spend by month';
  if (emptyEl) {
    emptyEl.textContent = 'Click the chart icon on a row in the table below to see monthly spend for that group.';
    emptyEl.hidden = false;
  }
  if (canvasWrap) canvasWrap.hidden = true;
}

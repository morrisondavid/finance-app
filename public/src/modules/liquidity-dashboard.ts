/**
 * Dashboard tab — household liquidity hero from GET /api/dashboard/summary (liquidityOverview).
 */

import type { DashboardSummaryResponse } from '../../../shared/api-contracts.js';
import { fetchDashboard } from '../utils/api';
import { formatCurrency } from '../utils/formatting';
import { escapeHtml } from '../utils/dom';
import { state } from './state';

function rootEl(): HTMLElement | null {
  return document.getElementById('liquidity-dashboard-root');
}

function renderLineRow(line: DashboardSummaryResponse['liquidityOverview']['lines'][number]): string {
  const native = formatCurrency(line.amountNative, line.currency);
  const gbpEq = formatCurrency(line.amountGbp, 'GBP');
  const isCredit = line.kind === 'credit';
  const kindBlock = isCredit
    ? '<span class="liquidity-dashboard__credit-label"><strong>Credit available</strong></span>'
    : '';
  return `
      <li class="liquidity-dashboard__row${isCredit ? ' liquidity-dashboard__row--credit' : ''}">
        <div class="liquidity-dashboard__row-text">
          <span class="liquidity-dashboard__row-label">${escapeHtml(line.label)}</span>
          ${kindBlock}
        </div>
        <div class="liquidity-dashboard__row-amounts">
          <span class="liquidity-dashboard__native">${native}</span>
          <span class="liquidity-dashboard__gbp-eq">${gbpEq}</span>
        </div>
      </li>`;
}

function splitSummary(cashGbp: number, totalGbp: number): string {
  if (totalGbp === 0 && cashGbp === 0) {
    return '';
  }
  if (totalGbp <= 0) {
    return '<p class="liquidity-dashboard__split-summary">Combined total is zero or negative in GBP terms.</p>';
  }
  const cashPct = Math.round((cashGbp / totalGbp) * 100);
  const creditPct = 100 - cashPct;
  const combined = formatCurrency(totalGbp, 'GBP');
  return `<p class="liquidity-dashboard__split-summary"><strong>${cashPct}%</strong> cash · <strong>${creditPct}%</strong> credit — combined <strong>${combined}</strong></p>`;
}

function renderSkeleton(): string {
  return `
    <div class="liquidity-dashboard__inner">
      <div class="liquidity-dashboard__card liquidity-dashboard__card--loading" role="status" aria-busy="true">
        <p class="liquidity-dashboard__kicker">Available to spend</p>
        <div class="liquidity-dashboard__split" aria-hidden="true">
          <div class="liquidity-dashboard__split-pane">
            <p class="liquidity-dashboard__pane-kicker liquidity-dashboard__skeleton-line liquidity-dashboard__skeleton-line--kicker">&nbsp;</p>
            <p class="liquidity-dashboard__total liquidity-dashboard__skeleton-line liquidity-dashboard__skeleton-line--lg">&nbsp;</p>
          </div>
          <div class="liquidity-dashboard__split-pane">
            <p class="liquidity-dashboard__pane-kicker liquidity-dashboard__skeleton-line liquidity-dashboard__skeleton-line--kicker">&nbsp;</p>
            <p class="liquidity-dashboard__total liquidity-dashboard__skeleton-line liquidity-dashboard__skeleton-line--lg">&nbsp;</p>
          </div>
        </div>
        <p class="liquidity-dashboard__split-summary liquidity-dashboard__skeleton-line liquidity-dashboard__skeleton-line--split-meta">&nbsp;</p>
        <ul class="liquidity-dashboard__list" aria-hidden="true">
          <li class="liquidity-dashboard__skeleton-row" aria-hidden="true"></li>
          <li class="liquidity-dashboard__skeleton-row" aria-hidden="true"></li>
        </ul>
      </div>
    </div>
  `;
}

function renderError(message: string): string {
  return `
    <div class="liquidity-dashboard__inner">
      <div class="liquidity-dashboard__card liquidity-dashboard__card--error" role="alert">
        <p class="liquidity-dashboard__error-title">Could not load liquidity</p>
        <p class="liquidity-dashboard__error-detail">${escapeHtml(message)}</p>
      </div>
    </div>
  `;
}

function renderCard(overview: DashboardSummaryResponse['liquidityOverview']): string {
  const { totalCashGbp, totalCreditGbp, totalAvailableGbp, lines } = overview;

  if (lines.length === 0) {
    return `
      <div class="liquidity-dashboard__inner">
        <div class="liquidity-dashboard__card">
          <p class="liquidity-dashboard__kicker">Available to spend</p>
          ${renderSplitHero(0, 0, 0)}
          <p class="liquidity-dashboard__empty">No account balances to show.</p>
        </div>
      </div>
    `;
  }

  const cashLines = lines.filter(l => l.kind === 'cash');
  const creditLines = lines.filter(l => l.kind === 'credit');

  const cashSection =
    cashLines.length === 0
      ? '<p class="liquidity-dashboard__breakdown-empty">No cash accounts in registry.</p>'
      : `<ul class="liquidity-dashboard__list liquidity-dashboard__list--breakdown">${cashLines.map(renderLineRow).join('')}</ul>`;

  const creditSection =
    creditLines.length === 0
      ? '<p class="liquidity-dashboard__breakdown-empty">No credit cards in registry.</p>'
      : `<ul class="liquidity-dashboard__list liquidity-dashboard__list--breakdown">${creditLines.map(renderLineRow).join('')}</ul>`;

  return `
    <div class="liquidity-dashboard__inner">
      <div class="liquidity-dashboard__card">
        <p class="liquidity-dashboard__kicker">Available to spend</p>
        ${renderSplitHero(totalCashGbp, totalCreditGbp, totalAvailableGbp)}
        <p class="liquidity-dashboard__subtitle">Static AED→GBP (and other) rates on the server — totals are directional, not live market rates.</p>

        <div class="liquidity-dashboard__breakdown-columns">
          <div class="liquidity-dashboard__breakdown-column">
            <h2 class="liquidity-dashboard__breakdown-heading liquidity-dashboard__breakdown-heading--cash">Cash accounts</h2>
            ${cashSection}
          </div>
          <div class="liquidity-dashboard__breakdown-column">
            <h2 class="liquidity-dashboard__breakdown-heading liquidity-dashboard__breakdown-heading--credit">Credit cards</h2>
            ${creditSection}
          </div>
        </div>

        <p class="liquidity-dashboard__footnote">Negative cash balances reduce the cash total. Credit figures are available headroom, not debt owed.</p>
      </div>
    </div>
  `;
}

function renderSplitHero(totalCashGbp: number, totalCreditGbp: number, totalAvailableGbp: number): string {
  const cashStr = formatCurrency(totalCashGbp, 'GBP');
  const creditStr = formatCurrency(totalCreditGbp, 'GBP');
  return `
        <div class="liquidity-dashboard__split">
          <section class="liquidity-dashboard__split-pane liquidity-dashboard__split-pane--cash" aria-label="Cash and savings in GBP">
            <h3 class="liquidity-dashboard__pane-kicker">Cash & savings</h3>
            <p class="liquidity-dashboard__total liquidity-dashboard__total--cash">${cashStr}</p>
          </section>
          <section class="liquidity-dashboard__split-pane liquidity-dashboard__split-pane--credit" aria-label="Credit headroom in GBP">
            <h3 class="liquidity-dashboard__pane-kicker">Credit available</h3>
            <p class="liquidity-dashboard__total liquidity-dashboard__total--credit">${creditStr}</p>
          </section>
        </div>
        ${splitSummary(totalCashGbp, totalAvailableGbp)}
  `;
}

/** Load and render liquidity hero + breakdown (same summary API as Accounts tab). */
export async function loadLiquidityDashboard(): Promise<void> {
  const el = rootEl();
  if (!el) return;

  el.innerHTML = renderSkeleton();

  try {
    const data = await fetchDashboard({
      account: state.selectedAccount,
      financialYear: state.selectedFinancialYear || undefined,
    });
    el.innerHTML = renderCard(data.liquidityOverview);
  } catch (error) {
    console.error('[Liquidity dashboard]', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    el.innerHTML = renderError(message);
  }
}

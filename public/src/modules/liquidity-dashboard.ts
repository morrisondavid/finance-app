/**
 * Dashboard tab — household liquidity hero from GET /api/dashboard/summary (liquidityOverview).
 */

import type { DashboardSummaryResponse } from '../../../shared/api-contracts.js';
import { fetchDashboard } from '../utils/api';
import { formatCurrency } from '../utils/formatting';
import { escapeHtml } from '../utils/dom';
import { state } from './state';

const HERO_KICKER = 'Household liquidity';

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

type LiquidityCommitmentLine = NonNullable<
  DashboardSummaryResponse['liquidityCommitments']
>['lines'][number];

function renderCommitmentRow(line: LiquidityCommitmentLine): string {
  const gbp = formatCurrency(line.amountGbp, 'GBP');
  const due =
    line.dueDate !== null
      ? `<span class="liquidity-dashboard__commitment-due">${escapeHtml(line.dueDate)}</span>`
      : '';
  const sigNote = line.significant
    ? `<span class="liquidity-dashboard__commitment-significant-flag">Save ahead</span>`
    : '';
  const rowClass = `liquidity-dashboard__row liquidity-dashboard__row--commitment${
    line.significant ? ' liquidity-dashboard__row--commitment-significant' : ''
  }`;
  return `
      <li class="${rowClass}">
        <div class="liquidity-dashboard__row-text">
          <span class="liquidity-dashboard__row-label">${escapeHtml(line.label)}</span>
          ${due}
          ${sigNote}
        </div>
        <div class="liquidity-dashboard__row-amounts liquidity-dashboard__row-amounts--commitment">
          <span class="liquidity-dashboard__native">${gbp}</span>
        </div>
      </li>`;
}

function renderCommitmentList(lines: readonly LiquidityCommitmentLine[]): string {
  if (lines.length === 0) return '';
  return `<ul class="liquidity-dashboard__list liquidity-dashboard__list--breakdown liquidity-dashboard__list--commitments">${lines.map(renderCommitmentRow).join('')}</ul>`;
}

function renderCommitmentSections(lines: NonNullable<DashboardSummaryResponse['liquidityCommitments']>['lines']): string {
  if (lines.length === 0) {
    return '<p class="liquidity-dashboard__breakdown-empty">No commitment lines in this 12-month window.</p>';
  }
  const ob = lines.filter(l => l.source === 'obligation');
  const rec = lines.filter(l => l.source === 'recurring-fixed');
  const parts: string[] = [];
  if (ob.length > 0) {
    parts.push(
      '<p class="liquidity-dashboard__commitment-group-title">Obligations</p>',
      renderCommitmentList(ob),
    );
  }
  if (rec.length > 0) {
    parts.push(
      '<p class="liquidity-dashboard__commitment-group-title">Recurring fixed (projected)</p>',
      renderCommitmentList(rec),
    );
  }
  return parts.join('');
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
        <p class="liquidity-dashboard__kicker">${escapeHtml(HERO_KICKER)}</p>
        <div class="liquidity-dashboard__hero-grid" aria-hidden="true">
          ${[1, 2, 3, 4].map(() => `<div class="liquidity-dashboard__hero-tile">
            <p class="liquidity-dashboard__pane-kicker liquidity-dashboard__skeleton-line liquidity-dashboard__skeleton-line--kicker">&nbsp;</p>
            <p class="liquidity-dashboard__total liquidity-dashboard__skeleton-line liquidity-dashboard__skeleton-line--lg">&nbsp;</p>
          </div>`).join('')}
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

function renderHeroMetrics(
  totalCashGbp: number,
  totalCreditGbp: number,
  totalAvailableGbp: number,
  commitments: DashboardSummaryResponse['liquidityCommitments'],
): string {
  const cashStr = formatCurrency(totalCashGbp, 'GBP');
  const creditStr = formatCurrency(totalCreditGbp, 'GBP');

  if (commitments === null) {
    return `
        <div class="liquidity-dashboard__hero-grid liquidity-dashboard__hero-grid--two">
          <section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--cash" aria-label="Cash and savings in GBP">
            <h3 class="liquidity-dashboard__pane-kicker">Cash & savings</h3>
            <p class="liquidity-dashboard__total liquidity-dashboard__total--cash">${cashStr}</p>
          </section>
          <section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--credit" aria-label="Credit headroom in GBP">
            <h3 class="liquidity-dashboard__pane-kicker">Credit available</h3>
            <p class="liquidity-dashboard__total liquidity-dashboard__total--credit">${creditStr}</p>
          </section>
        </div>
        ${splitSummary(totalCashGbp, totalAvailableGbp)}
    `;
  }

  const rawAfter = commitments.cashAfterCommitmentsGbp;
  const displayAfter = Math.max(0, rawAfter);
  const committedStr = formatCurrency(commitments.totalCommittedGbp, 'GBP');
  const afterStr = formatCurrency(displayAfter, 'GBP');

  return `
        <div class="liquidity-dashboard__hero-grid">
          <section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--cash" aria-label="Cash and savings in GBP">
            <h3 class="liquidity-dashboard__pane-kicker">Cash & savings</h3>
            <p class="liquidity-dashboard__total liquidity-dashboard__total--cash">${cashStr}</p>
          </section>
          <section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--credit" aria-label="Credit headroom in GBP">
            <h3 class="liquidity-dashboard__pane-kicker">Credit available</h3>
            <p class="liquidity-dashboard__total liquidity-dashboard__total--credit">${creditStr}</p>
          </section>
          <section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--committed" aria-label="Committed outflows next 12 months">
            <h3 class="liquidity-dashboard__pane-kicker">Committed (12 mo)</h3>
            <p class="liquidity-dashboard__total liquidity-dashboard__total--committed">${committedStr}</p>
          </section>
          <section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--after" aria-label="Cash after commitments">
            <h3 class="liquidity-dashboard__pane-kicker">Cash after commitments</h3>
            <p class="liquidity-dashboard__total liquidity-dashboard__total--after">${afterStr}</p>
            ${rawAfter < 0 ? '<p class="liquidity-dashboard__hero-underwater">Model negative — showing £0.</p>' : ''}
          </section>
        </div>
        ${splitSummary(totalCashGbp, totalAvailableGbp)}
    `;
}

function renderCommitmentsDetail(commitments: NonNullable<DashboardSummaryResponse['liquidityCommitments']>): string {
  const th = formatCurrency(commitments.significantThresholdGbp, 'GBP');
  return `
    <div class="liquidity-dashboard__commitments-panel">
      <h2 class="liquidity-dashboard__commitments-panel-title">Committed outflows — ${escapeHtml(commitments.horizonLabel)}</h2>
      <p class="liquidity-dashboard__commitments-panel-meta">${escapeHtml(commitments.horizonStartDate)} → ${escapeHtml(commitments.horizonEndDate)} · obligations due up to one year late are included · lines ≥ ${th} flagged &ldquo;Save ahead&rdquo;</p>
      ${renderCommitmentSections(commitments.lines)}
      <p class="liquidity-dashboard__commitment-total">
        <span class="liquidity-dashboard__commitment-total-label">Total committed (model)</span>
        <span class="liquidity-dashboard__commitment-total-amount">${formatCurrency(commitments.totalCommittedGbp, 'GBP')}</span>
      </p>
      <p class="liquidity-dashboard__double-count-note">Obligations and recurring projections may overlap for the same bill; totals are directional. Cash after commitments is cash only — credit headroom is not netted in.</p>
    </div>`;
}

function renderCard(
  overview: DashboardSummaryResponse['liquidityOverview'],
  commitments: DashboardSummaryResponse['liquidityCommitments'],
): string {
  const { totalCashGbp, totalCreditGbp, totalAvailableGbp, lines } = overview;

  if (lines.length === 0) {
    return `
      <div class="liquidity-dashboard__inner">
        <div class="liquidity-dashboard__card">
          <p class="liquidity-dashboard__kicker">${escapeHtml(HERO_KICKER)}</p>
          ${renderHeroMetrics(0, 0, 0, commitments)}
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

  const commitmentsBlock =
    commitments !== null ? renderCommitmentsDetail(commitments) : '';

  return `
    <div class="liquidity-dashboard__inner">
      <div class="liquidity-dashboard__card">
        <p class="liquidity-dashboard__kicker">${escapeHtml(HERO_KICKER)}</p>
        ${renderHeroMetrics(totalCashGbp, totalCreditGbp, totalAvailableGbp, commitments)}
        <p class="liquidity-dashboard__subtitle">Static AED→GBP (and other) rates on the server — totals are directional, not live market rates.</p>

        <div class="liquidity-dashboard__breakdown-columns">
          <div class="liquidity-dashboard__breakdown-column">
            <h2 class="liquidity-dashboard__breakdown-heading liquidity-dashboard__breakdown-heading--cash">Cash accounts</h2>
            ${cashSection}
          </div>
          <div class="liquidity-dashboard__breakdown-column">
            <h2 class="liquidity-dashboard__breakdown-heading liquidity-dashboard__breakdown-heading--credit">Credit cards</h2>
            ${creditSection}
            <p class="liquidity-dashboard__credit-commitments-note">&ldquo;Cash after commitments&rdquo; does not include credit limits.</p>
          </div>
        </div>

        ${commitmentsBlock}

        <p class="liquidity-dashboard__footnote">Negative cash balances reduce the cash total. Credit figures are available headroom, not debt owed.</p>
      </div>
    </div>
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
    el.innerHTML = renderCard(data.liquidityOverview, data.liquidityCommitments);
  } catch (error) {
    console.error('[Liquidity dashboard]', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    el.innerHTML = renderError(message);
  }
}

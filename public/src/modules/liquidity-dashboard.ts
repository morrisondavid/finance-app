/**
 * Dashboard tab — household liquidity hero from GET /api/ai/liquidity.
 * Financial safety score loads lazily via GET /api/ai/financial-safety.
 */

import type { AiFinancialSafetyResponse, AiLiquidityResponse, AiAvailableFundsResponse, AiSurvivalResponse } from '../../../shared/api-contracts.js';
import { renderFinancialSafetyHero, renderTaxReserveNudges } from './financial-safety-hero.js';
import {
  fetchLiquidity,
  fetchFinancialSafety,
  fetchAvailableFunds,
  fetchSurvival,
  fetchSurvivalPlan,
  fetchEntityFoundationWarnings,
} from '../utils/api';
import { activateTabByName } from './tabs.js';
import { loadObligations } from './obligations.js';
import { formatCurrency, formatIsoDateUkLong, formatMonthYear } from '../utils/formatting';
import { escapeHtml } from '../utils/dom';
import { state } from './state';

const HERO_KICKER = 'Household liquidity';

let liquidityDashboardLoadGeneration = 0;
let liquidityDashboardAbort: AbortController | null = null;

function renderFinancialSafetyLazyStripLoading(): string {
  return `<div id="liquidity-fs-hero-slot" class="liquidity-fs-hero-slot" role="status" aria-busy="true">
      <div class="financial-safety-hero financial-safety-hero--loading">
        <div class="financial-safety-hero__skeleton-bar"></div>
      </div>
    </div>`;
}

function renderFinancialSafetyLazyStripDone(
  fs: AiFinancialSafetyResponse,
  taxReserveNudgesHtml = '',
): string {
  const inner = renderFinancialSafetyHero(fs);
  if (inner === '' && taxReserveNudgesHtml === '') {
    return '<div id="liquidity-fs-hero-slot" class="liquidity-fs-hero-slot"></div>';
  }
  return `<div id="liquidity-fs-hero-slot" class="liquidity-fs-hero-slot">${inner}${taxReserveNudgesHtml}</div>`;
}

function bindTaxReserveNudgeClicks(container: ParentNode): void {
  container.querySelectorAll<HTMLButtonElement>('[data-tab-jump="obligations"]').forEach(btn => {
    btn.addEventListener('click', () => {
      activateTabByName('obligations');
      void loadObligations();
    });
  });
}

function renderFinancialSafetyLazyStripError(message: string): string {
  return `<div id="liquidity-fs-hero-slot" class="liquidity-fs-hero-slot liquidity-fs-hero-slot--error" role="alert">
      <p class="liquidity-dashboard__fs-error">${escapeHtml(message)}</p>
    </div>`;
}

function rootEl(): HTMLElement | null {
  return document.getElementById('liquidity-dashboard-root');
}

function renderLineRow(line: AiLiquidityResponse['liquidityOverview']['lines'][number]): string {
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
  AiLiquidityResponse['liquidityCommitments']
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

function renderCommitmentSections(lines: NonNullable<AiLiquidityResponse['liquidityCommitments']>['lines']): string {
  if (lines.length === 0) {
    return '<p class="liquidity-dashboard__breakdown-empty">No commitment lines in this window.</p>';
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

function splitSummary(cashGbp: number, creditGbp: number, totalGbp: number): string {
  if (totalGbp === 0 && cashGbp === 0 && creditGbp === 0) {
    return '';
  }
  if (totalGbp <= 0) {
    return '<p class="liquidity-dashboard__split-summary">Combined total is zero or negative in GBP terms.</p>';
  }
  const cashPct = Math.round((cashGbp / totalGbp) * 100);
  const creditPct = 100 - cashPct;
  const combined = formatCurrency(totalGbp, 'GBP');
  const creditStr = formatCurrency(creditGbp, 'GBP');
  return `<p class="liquidity-dashboard__split-summary"><strong>${cashPct}%</strong> cash · <strong>${creditPct}%</strong> credit — combined <strong>${combined}</strong> · credit headroom <strong>${creditStr}</strong></p>`;
}

function renderSkeleton(): string {
  return `
    <div class="liquidity-dashboard__inner">
      <div class="financial-safety-hero financial-safety-hero--loading" role="status" aria-busy="true">
        <div class="financial-safety-hero__skeleton-bar"></div>
      </div>
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

function renderHorizonToggle(activeMonths: number): string {
  const options = [3, 6, 12] as const;
  const buttons = options.map(
    m => `<button type="button" class="liquidity-dashboard__horizon-btn${m === activeMonths ? ' liquidity-dashboard__horizon-btn--active' : ''}" data-months="${String(m)}">${String(m)} mo</button>`,
  ).join('');
  return `<div class="liquidity-dashboard__funds-toolbar">
      <div class="liquidity-dashboard__horizon-toggle" role="group" aria-label="Funds horizon">${buttons}</div>
    </div>`;
}

function renderFundsRow(available: AiAvailableFundsResponse, totalCreditGbp: number): string {
  const mo = available.months;
  const netRaw = available.netAfterCommitmentsGbp;
  const netDisplay = Math.max(0, netRaw);
  const netStr = formatCurrency(netDisplay, 'GBP');
  const creditStr = formatCurrency(totalCreditGbp, 'GBP');
  const totalFundsCash = formatCurrency(available.totalFundsGbp, 'GBP');
  const totalFundsWithCredit = formatCurrency(available.totalFundsWithCreditGbp, 'GBP');
  return `<div id="liquidity-funds-block">
    ${renderHorizonToggle(mo)}
    <div class="liquidity-dashboard__hero-grid liquidity-dashboard__hero-grid--funds">
      <section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--cash" aria-label="Cash and savings">
        <h3 class="liquidity-dashboard__pane-kicker">Cash &amp; savings</h3>
        <p class="liquidity-dashboard__total liquidity-dashboard__total--cash">${formatCurrency(available.availableNowGbp, 'GBP')}</p>
      </section>
      <section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--insight" aria-label="Future income after tax">
        <h3 class="liquidity-dashboard__pane-kicker">Future income (after tax)</h3>
        <p class="liquidity-dashboard__total">${formatCurrency(available.confirmedFutureIncomeRetainedGbp, 'GBP')}</p>
        <p class="liquidity-dashboard__insight-sub">After VAT and CT on uninvoiced accrual</p>
        <p class="liquidity-dashboard__insight-sub">Gross ${formatCurrency(available.confirmedFutureIncomeGrossGbp, 'GBP')}, less CT ${formatCurrency(available.futureIncomeCtReserveGbp, 'GBP')}</p>
      </section>
      <section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--credit" aria-label="Credit headroom in GBP">
        <h3 class="liquidity-dashboard__pane-kicker">Credit available</h3>
        <p class="liquidity-dashboard__total liquidity-dashboard__total--credit">${creditStr}</p>
      </section>
      <section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--insight" aria-label="Total funds">
        <h3 class="liquidity-dashboard__pane-kicker">Total funds</h3>
        <p class="liquidity-dashboard__total">${totalFundsCash}</p>
        <p class="liquidity-dashboard__insight-sub">= cash + ${String(mo)} mo future income (after tax)</p>
        <p class="liquidity-dashboard__total liquidity-dashboard__total--with-credit">${totalFundsWithCredit}</p>
        <p class="liquidity-dashboard__insight-sub">= above + credit available</p>
      </section>
      <section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--committed" aria-label="Committed outflows">
        <h3 class="liquidity-dashboard__pane-kicker">Committed (${String(mo)} mo)</h3>
        <p class="liquidity-dashboard__total liquidity-dashboard__total--committed">${formatCurrency(available.committedOutflowsGbp, 'GBP')}</p>
        <p class="liquidity-dashboard__insight-sub">To ${escapeHtml(available.projectionEndDate)}</p>
      </section>
      <section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--after" aria-label="Net after commitments">
        <h3 class="liquidity-dashboard__pane-kicker">Net after commitments</h3>
        <p class="liquidity-dashboard__total liquidity-dashboard__total--after">${netStr}</p>
        <p class="liquidity-dashboard__insight-sub">= total funds − committed</p>
        ${netRaw < 0 ? '<p class="liquidity-dashboard__hero-underwater">Model negative — showing £0.</p>' : ''}
      </section>
    </div>
  </div>`;
}

function renderHeroMetrics(
  totalCashGbp: number,
  totalCreditGbp: number,
  totalAvailableGbp: number,
  available: AiAvailableFundsResponse | null,
): string {
  if (available !== null) {
    return `${renderFundsRow(available, totalCreditGbp)}${splitSummary(totalCashGbp, totalCreditGbp, totalAvailableGbp)}`;
  }

  const cashStr = formatCurrency(totalCashGbp, 'GBP');
  const creditStr = formatCurrency(totalCreditGbp, 'GBP');
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
        ${splitSummary(totalCashGbp, totalCreditGbp, totalAvailableGbp)}
    `;
}

type CommitmentsOverview = NonNullable<AiLiquidityResponse['liquidityCommitments']>;

/**
 * Committed-outflows panel wrapped in an id'd slot so the horizon toggle can
 * swap it. Prefers the horizon-scoped overview from `available-funds`; falls
 * back to the (12-month) liquidity payload when funds aren't loaded.
 */
function renderCommitmentsSlot(
  available: AiAvailableFundsResponse | null,
  liquidityCommitments: CommitmentsOverview | null,
): string {
  const overview = available?.committedOutflows ?? liquidityCommitments;
  const inner = overview !== null && overview !== undefined ? renderCommitmentsDetail(overview) : '';
  return `<div id="liquidity-commitments-slot">${inner}</div>`;
}

function renderCommitmentsDetail(commitments: CommitmentsOverview): string {
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

function renderInsightPods(
  available: AiAvailableFundsResponse | null,
  survival: AiSurvivalResponse | null,
): string {
  if (available === null && survival === null) return '';

  let blocks = '';

  if (available !== null) {
    const clients = available.futureIncomeByClient.length > 0
      ? available.futureIncomeByClient
      : available.futureIncomeByContract;
    const clientLines = clients
      .map(c => `<li>
          <span class="liquidity-dashboard__insight-breakdown-label">${escapeHtml(c.label)}</span>
          <span class="liquidity-dashboard__insight-breakdown-amount">${formatCurrency(c.totalGbp, 'GBP')}</span>
        </li>`)
      .join('');
    const monthLines = available.futureIncomeByMonth
      .map(
        m => `<li><span class="liquidity-dashboard__insight-breakdown-label">${escapeHtml(formatMonthYear(m.month))}</span><span class="liquidity-dashboard__insight-breakdown-amount">${formatCurrency(m.amountGbp, 'GBP')}</span></li>`,
      )
      .join('');

    blocks += `<section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--insight" aria-label="Future income breakdown">
        <h3 class="liquidity-dashboard__pane-kicker">Future income breakdown</h3>
        ${clientLines !== '' ? `<p class="liquidity-dashboard__insight-breakdown-heading">By source</p><ul class="liquidity-dashboard__insight-breakdown">${clientLines}</ul>` : ''}
        ${monthLines !== '' ? `<p class="liquidity-dashboard__insight-breakdown-heading">By month (all clients combined)</p><ul class="liquidity-dashboard__insight-breakdown">${monthLines}</ul>` : ''}
      </section>`;

    if (available.lastContractPayment !== null) {
      const lp = available.lastContractPayment;
      blocks += `<section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--insight liquidity-dashboard__hero-tile--final-payment" aria-label="Final contract payment">
        <h3 class="liquidity-dashboard__pane-kicker">Final contract payment</h3>
        <p class="liquidity-dashboard__total">${escapeHtml(formatIsoDateUkLong(lp.date))}</p>
        <p class="liquidity-dashboard__total liquidity-dashboard__total--final-amount">${formatCurrency(lp.amountGbp, 'GBP')}</p>
        <p class="liquidity-dashboard__insight-sub">${escapeHtml(lp.label)}</p>
      </section>`;
    }
  }

  const daily = survival?.given?.dailyDiscretionary ?? survival?.solveForTarget?.maxDailyDiscretionary;
  const survivalBlock = survival !== null && daily !== undefined
    ? `<section class="liquidity-dashboard__hero-tile liquidity-dashboard__hero-tile--survival" aria-label="Survival mode">
        <h3 class="liquidity-dashboard__pane-kicker">Survival mode</h3>
        <p class="liquidity-dashboard__total">Safe to spend: ${formatCurrency(daily, 'GBP')}/day</p>
        <p class="liquidity-dashboard__insight-sub">Lasts until ${escapeHtml(survival.given?.survivalDateCashOnly ?? '—')} (cash)</p>
        ${survival.given?.survivalDateCreditIncluded
          ? `<p class="liquidity-dashboard__insight-sub">Incl. credit: ${escapeHtml(survival.given.survivalDateCreditIncluded)}</p>`
          : ''}
        <p class="liquidity-dashboard__insight-sub">Essentials ~${formatCurrency(survival.essentialsMonthlyGbp, 'GBP')}/mo covered</p>
        <label class="liquidity-dashboard__survival-control">
          <span>Adjust £/day</span>
          <input type="number" id="survival-daily-input" min="0" step="1" value="${String(Math.round(daily))}" />
        </label>
      </section>`
    : '';

  return `<div class="liquidity-dashboard__hero-grid liquidity-dashboard__hero-grid--insights">${blocks}${survivalBlock}</div>`;
}

let cachedAvailableFunds: AiAvailableFundsResponse | null = null;
let cachedSurvival: AiSurvivalResponse | null = null;
let cachedLiquidityCreditGbp = 0;

function bindHorizonToggle(ac: AbortController, myGen: number): void {
  const buttons = document.querySelectorAll('.liquidity-dashboard__horizon-btn');
  for (const btn of buttons) {
    if (!(btn instanceof HTMLButtonElement)) continue;
    btn.addEventListener('click', () => {
      const monthsRaw = btn.dataset.months;
      if (monthsRaw === undefined) return;
      const months = Number(monthsRaw);
      if (months !== 3 && months !== 6 && months !== 12) return;
      void (async () => {
        try {
          const available = await fetchAvailableFunds({ months, signal: ac.signal });
          if (myGen !== liquidityDashboardLoadGeneration) return;
          cachedAvailableFunds = available;
          const fundsSlot = document.getElementById('liquidity-funds-block');
          if (fundsSlot !== null) {
            fundsSlot.outerHTML = renderFundsRow(available, cachedLiquidityCreditGbp);
            bindHorizonToggle(ac, myGen);
          }
          const insightSlot = document.getElementById('liquidity-insight-pods');
          if (insightSlot !== null) {
            insightSlot.innerHTML = renderInsightPods(available, cachedSurvival);
            bindSurvivalControl(ac, myGen);
          }
          const commitmentsSlot = document.getElementById('liquidity-commitments-slot');
          if (commitmentsSlot !== null) {
            commitmentsSlot.outerHTML = renderCommitmentsSlot(available, null);
          }
        } catch (err) {
          console.error('[Funds horizon]', err);
        }
      })();
    });
  }
}

function bindSurvivalControl(ac: AbortController, myGen: number): void {
  const input = document.getElementById('survival-daily-input');
  if (!(input instanceof HTMLInputElement)) return;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  input.addEventListener('change', () => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      void (async () => {
        const daily = Number(input.value);
        if (!Number.isFinite(daily) || daily < 0) return;
        try {
          const survival = await fetchSurvival({ dailyDiscretionary: daily, signal: ac.signal });
          if (myGen !== liquidityDashboardLoadGeneration) return;
          cachedSurvival = survival;
          const slot = document.getElementById('liquidity-insight-pods');
          if (!slot) return;
          slot.innerHTML = renderInsightPods(cachedAvailableFunds, survival);
          bindSurvivalControl(ac, myGen);
        } catch (err) {
          console.error('[Survival pod]', err);
        }
      })();
    }, 300);
  });
}

function renderCard(
  overview: AiLiquidityResponse['liquidityOverview'],
  commitments: AiLiquidityResponse['liquidityCommitments'],
  financialSafetyStripHtml: string,
  availableFunds: AiAvailableFundsResponse | null,
  insightPodsHtml: string,
): string {
  const { totalCashGbp, totalCreditGbp, totalAvailableGbp, lines } = overview;

  if (lines.length === 0) {
    return `
      <div class="liquidity-dashboard__inner">
        ${financialSafetyStripHtml}
        <div class="liquidity-dashboard__card">
          <p class="liquidity-dashboard__kicker">${escapeHtml(HERO_KICKER)}</p>
          ${renderHeroMetrics(0, 0, 0, availableFunds)}
          <div id="liquidity-insight-pods">${insightPodsHtml}</div>
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

  const commitmentsBlock = renderCommitmentsSlot(availableFunds, commitments);

  return `
    <div class="liquidity-dashboard__inner">
      ${financialSafetyStripHtml}
      <div class="liquidity-dashboard__card">
        <p class="liquidity-dashboard__kicker">${escapeHtml(HERO_KICKER)}</p>
        ${renderHeroMetrics(totalCashGbp, totalCreditGbp, totalAvailableGbp, availableFunds)}
        <div id="liquidity-insight-pods">${insightPodsHtml}</div>
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

/** Load and render liquidity hero + breakdown via GET /api/ai/liquidity. */
export async function loadLiquidityDashboard(): Promise<void> {
  const el = rootEl();
  if (!el) return;

  liquidityDashboardAbort?.abort();
  const myGen = ++liquidityDashboardLoadGeneration;
  const ac = new AbortController();
  liquidityDashboardAbort = ac;

  el.innerHTML = renderSkeleton();

  try {
    const [data, availableFunds] = await Promise.all([
      fetchLiquidity({
        account: state.selectedAccount,
        financialYear: state.selectedFinancialYear || undefined,
        signal: ac.signal,
      }),
      fetchAvailableFunds({ signal: ac.signal }).catch(() => null),
    ]);

    let survival: AiSurvivalResponse | null = null;
    try {
      const planResponse = await fetchSurvivalPlan({ signal: ac.signal });
      if (planResponse.plan !== null) {
        survival = await fetchSurvival({
          dailyDiscretionary: planResponse.plan.dailyAmount,
          scope: planResponse.plan.scope,
          signal: ac.signal,
        });
      }
    } catch {
      survival = null;
    }

    if (myGen !== liquidityDashboardLoadGeneration) return;

    cachedAvailableFunds = availableFunds;
    cachedSurvival = survival;
    cachedLiquidityCreditGbp = data.liquidityOverview.totalCreditGbp;
    const insightPodsHtml = renderInsightPods(availableFunds, survival);

    el.innerHTML = renderCard(
      data.liquidityOverview,
      data.liquidityCommitments,
      renderFinancialSafetyLazyStripLoading(),
      availableFunds,
      insightPodsHtml,
    );
    bindHorizonToggle(ac, myGen);
    bindSurvivalControl(ac, myGen);

    try {
      const [fs, warningsResp] = await Promise.all([
        fetchFinancialSafety({
          account: state.selectedAccount,
          financialYear: state.selectedFinancialYear || undefined,
          signal: ac.signal,
        }),
        fetchEntityFoundationWarnings().catch(() => ({ warnings: [] })),
      ]);
      if (myGen !== liquidityDashboardLoadGeneration) return;
      const slot = el.querySelector('#liquidity-fs-hero-slot');
      const taxReserveNudgesHtml = renderTaxReserveNudges(warningsResp.warnings);
      if (slot) {
        slot.outerHTML = renderFinancialSafetyLazyStripDone(fs, taxReserveNudgesHtml).trim();
        bindTaxReserveNudgeClicks(el);
      }
    } catch (fsErr) {
      if (myGen !== liquidityDashboardLoadGeneration) return;
      if (fsErr instanceof DOMException && fsErr.name === 'AbortError') return;
      console.error('[Liquidity dashboard] financial safety:', fsErr);
      const slot = el.querySelector('#liquidity-fs-hero-slot');
      const msg =
        fsErr instanceof Error ? fsErr.message : 'Could not load financial safety.';
      if (slot) {
        slot.outerHTML = renderFinancialSafetyLazyStripError(msg).trim();
      }
    }
  } catch (error) {
    if (myGen !== liquidityDashboardLoadGeneration) return;
    if (error instanceof DOMException && error.name === 'AbortError') return;
    console.error('[Liquidity dashboard]', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    el.innerHTML = renderError(message);
  }
}

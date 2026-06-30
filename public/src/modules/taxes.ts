/**
 * Taxes tab — unified UK Ltd + FZCO + personal Self Assessment overview.
 */

import { escapeHtml } from '../utils/dom';
import { formatCurrency, formatIsoDateUkLong } from '../utils/formatting';
import { fetchTaxOverview } from '../utils/api';
import type {
  TaxOverviewEntityPanel,
  TaxOverviewLine,
  TaxOverviewSelfAssessmentPanel,
} from '../../../shared/api-contracts.js';

function entityTitle(entityId: string): string {
  if (entityId === 'autonize-it-ltd') return 'Autonize IT Ltd (UK)';
  if (entityId === 'autonize-it-fzco') return 'Autonize IT FZCO (UAE)';
  return entityId;
}

function reserveChip(status: TaxOverviewLine['reserveStatus']): string {
  if (status === null || status === 'none') return '';
  const label = status === 'funded' ? 'Reserve funded' : 'Reserve underfunded';
  const cls = status === 'funded' ? 'taxes-reserve--ok' : 'taxes-reserve--warn';
  return `<span class="taxes-reserve ${cls}">${escapeHtml(label)}</span>`;
}

function renderVatTrackerBar(line: TaxOverviewLine): string {
  if (line.kind !== 'vat-threshold-tracker' || line.detail === null) return '';
  const incomeMatch = line.detail.match(/Trailing 12m income AED ([\d,]+)/);
  const mandatoryMatch = line.detail.match(/mandatory ([\d,]+)/);
  if (incomeMatch === null || mandatoryMatch === null) return '';
  const income = Number(incomeMatch[1].replace(/,/g, ''));
  const mandatory = Number(mandatoryMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(income) || !Number.isFinite(mandatory) || mandatory <= 0) return '';
  const pct = Math.min(100, Math.round((income / mandatory) * 100));
  return `<div class="taxes-vat-tracker" role="meter" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <div class="taxes-vat-tracker-bar" style="width:${pct}%"></div>
  </div>`;
}

function renderLine(line: TaxOverviewLine): string {
  const amountHtml =
    line.amount !== null
      ? `<span class="taxes-line-amount">${escapeHtml(formatCurrency(line.amount, line.currency))}</span>`
      : '';
  const dueHtml =
    line.dueDate !== null
      ? `<span class="taxes-line-due">Due ${escapeHtml(formatIsoDateUkLong(line.dueDate))}</span>`
      : '';
  const detailHtml =
    line.detail !== null ? `<p class="taxes-line-detail">${escapeHtml(line.detail)}</p>` : '';
  return `<li class="taxes-line taxes-line--${escapeHtml(line.kind)}">
    <div class="taxes-line-head">
      <span class="taxes-line-label">${escapeHtml(line.label)}</span>
      ${amountHtml}
      ${dueHtml}
      ${reserveChip(line.reserveStatus)}
    </div>
    ${detailHtml}
    ${renderVatTrackerBar(line)}
  </li>`;
}

function renderEntityPanel(panel: TaxOverviewEntityPanel): string {
  const gbpNote =
    panel.currency !== 'GBP'
      ? `<span class="taxes-panel-gbp-note">${escapeHtml(formatCurrency(panel.headlineTotalGbp, 'GBP'))} combined</span>`
      : '';
  const fundLines = panel.lines.filter(l => l.kind === 'account-balance');
  const taxLines = panel.lines.filter(l => l.kind !== 'account-balance');
  const fundsSection =
    fundLines.length > 0
      ? `<section class="taxes-funds-section">
      <h4 class="taxes-funds-heading">Funds</h4>
      <ul class="taxes-lines taxes-lines--funds">${fundLines.map(renderLine).join('')}</ul>
    </section>`
      : '';
  return `<article class="taxes-panel liabilities-panel" id="taxes-panel-${escapeHtml(panel.entityId)}">
    <header class="taxes-panel-header">
      <h3>${escapeHtml(entityTitle(panel.entityId))}</h3>
      <p class="taxes-panel-headline">${escapeHtml(formatCurrency(panel.headlineTotal, panel.currency))} estimated company tax ${gbpNote}</p>
    </header>
    ${fundsSection}
    <ul class="taxes-lines">${taxLines.map(renderLine).join('')}</ul>
  </article>`;
}

function renderSelfAssessmentPanel(panel: TaxOverviewSelfAssessmentPanel): string {
  return `<article class="taxes-panel taxes-panel--personal liabilities-panel" id="taxes-panel-self-assessment">
    <header class="taxes-panel-header">
      <h3>Self Assessment (Personal)</h3>
      <p class="taxes-panel-headline">${escapeHtml(formatCurrency(panel.headlineTotal, panel.currency))} estimated personal tax</p>
      <p class="taxes-panel-sub">Personal HMRC liability — not company tax on Autonize IT Ltd.</p>
    </header>
    <ul class="taxes-lines">${panel.lines.map(renderLine).join('')}</ul>
  </article>`;
}

function renderHeadline(
  entities: TaxOverviewEntityPanel[],
  selfAssessment: TaxOverviewSelfAssessmentPanel,
  combinedGbpTotal: number,
): string {
  const entityCards = entities
    .map(
      panel => `<div class="taxes-headline-card">
      <span class="taxes-headline-kicker">${escapeHtml(entityTitle(panel.entityId))}</span>
      <strong>${escapeHtml(formatCurrency(panel.headlineTotal, panel.currency))}</strong>
      ${
        panel.currency !== 'GBP'
          ? `<span class="taxes-headline-sub">${escapeHtml(formatCurrency(panel.headlineTotalGbp, 'GBP'))}</span>`
          : ''
      }
    </div>`,
    )
    .join('');
  const saCard = `<div class="taxes-headline-card">
    <span class="taxes-headline-kicker">Self Assessment</span>
    <strong>${escapeHtml(formatCurrency(selfAssessment.headlineTotal, 'GBP'))}</strong>
  </div>`;
  return `<div class="taxes-headline" id="taxes-headline">
    ${entityCards}
    ${saCard}
    <div class="taxes-headline-card taxes-headline-card--combined">
      <span class="taxes-headline-kicker">Combined (GBP)</span>
      <strong>${escapeHtml(formatCurrency(combinedGbpTotal, 'GBP'))}</strong>
    </div>
  </div>`;
}

function renderError(message: string): void {
  const root = document.getElementById('taxes');
  if (root === null) return;
  root.innerHTML = `<p class="taxes-error">${escapeHtml(message)}</p>`;
}

function renderOverview(data: Awaited<ReturnType<typeof fetchTaxOverview>>): void {
  const root = document.getElementById('taxes');
  if (root === null) return;
  root.innerHTML = `
    <header class="taxes-page-header">
      <h2>Taxes</h2>
      <p class="taxes-page-sub">Estimated company and personal tax liabilities for UK Ltd, Dubai FZCO, and Self Assessment (as of ${escapeHtml(formatIsoDateUkLong(data.generatedAt))}).</p>
    </header>
    ${renderHeadline(data.entities, data.selfAssessment, data.combinedGbpTotal)}
    <div class="taxes-panels">
      ${data.entities.map(renderEntityPanel).join('')}
      ${renderSelfAssessmentPanel(data.selfAssessment)}
    </div>
  `;
}

export function initTaxes(): void {
  /* Tab shell lives in index.html; data loads on tab activation. */
}

export async function loadTaxes(): Promise<void> {
  try {
    const data = await fetchTaxOverview();
    renderOverview(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load tax overview';
    renderError(message);
  }
}

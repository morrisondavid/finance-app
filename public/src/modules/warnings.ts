/**
 * Warnings tab — top-level surface for every warning the app emits
 * (Roadmap 1.1 Phase 7 for the entity-foundation slice; Roadmap 1.8
 * will extend this module with the full Solvency Warnings Engine).
 *
 * Currently renders two sections:
 *   - Entity-foundation warnings: TBC fields on `company.csv`, FZCO
 *     CT / QFZP gates, UAE VAT thresholds, IFZA license renewal, and
 *     the aggregate unclassified-inter-company count.
 *   - Inter-company movements (Phase 8): per-pair classification UI
 *     backed by `transaction-category-overrides.csv`.
 *
 * An empty state is shown only for the entity-foundation section;
 * the movements section has its own built-in empty copy.
 */

import {
  fetchEntityFoundationWarnings,
  fetchInterCompanyMovements,
  classifyInterCompanyMovement,
} from '../utils/api';
import { escapeHtml } from '../utils/dom';
import type {
  EntityFoundationWarning,
  WarningSeverity,
  InterCompanyMovementsResponse,
  InterCompanyMovementPair,
} from '../../../shared/api-contracts';
import { INTER_COMPANY_CATEGORIES } from '../../../shared/category-names';
import type { CategoryName } from '../../../shared/category-names';

const WARNINGS_CONTAINER_ID = 'entity-foundation-warnings';
const EMPTY_STATE_ID = 'warnings-empty-state';
const MOVEMENTS_BODY_ID = 'inter-company-movements-body';

export function initWarnings(): void {
  const body = document.getElementById(MOVEMENTS_BODY_ID);
  if (body !== null) {
    body.addEventListener('click', handleMovementsClick);
  }
}

export async function loadWarnings(): Promise<void> {
  await Promise.all([loadEntityFoundation(), loadInterCompanyMovements()]);
}

async function loadEntityFoundation(): Promise<void> {
  const container = document.getElementById(WARNINGS_CONTAINER_ID);
  const emptyState = document.getElementById(EMPTY_STATE_ID);
  if (!container) return;

  try {
    const response = await fetchEntityFoundationWarnings();
    renderWarnings(container, response.warnings);
    if (emptyState) {
      emptyState.hidden = response.warnings.length > 0;
    }
  } catch (error) {
    console.error('Failed to load warnings:', error);
    container.hidden = true;
    if (emptyState) {
      emptyState.hidden = false;
      emptyState.innerHTML = '<p class="error">Failed to load warnings. Please try again.</p>';
    }
  }
}

async function loadInterCompanyMovements(): Promise<void> {
  const body = document.getElementById(MOVEMENTS_BODY_ID);
  if (!body) return;
  try {
    const response = await fetchInterCompanyMovements();
    renderInterCompanyMovements(body, response);
  } catch (error) {
    console.error('Failed to load inter-company movements:', error);
    body.innerHTML = '<p class="error">Failed to load inter-company movements. Please try again.</p>';
  }
}

export function renderWarnings(
  container: HTMLElement,
  warnings: readonly EntityFoundationWarning[],
): void {
  if (warnings.length === 0) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  const sorted = [...warnings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const highest = sorted[0].severity;

  container.hidden = false;
  container.dataset.severity = highest;
  container.innerHTML = `
    <header class="entity-foundation-warnings__header">
      <span class="entity-foundation-warnings__icon" aria-hidden="true">${severityIcon(highest)}</span>
      <h3 class="entity-foundation-warnings__title">${warnings.length} entity-foundation ${warnings.length === 1 ? 'warning' : 'warnings'}</h3>
    </header>
    <ul class="entity-foundation-warnings__list">
      ${sorted.map(renderWarningItem).join('')}
    </ul>
  `;
}

function renderWarningItem(w: EntityFoundationWarning): string {
  return `
    <li class="entity-foundation-warnings__item" data-severity="${escapeHtml(w.severity)}" data-code="${escapeHtml(w.code)}">
      <div class="entity-foundation-warnings__item-title">
        <span class="entity-foundation-warnings__badge" data-severity="${escapeHtml(w.severity)}">${escapeHtml(severityLabel(w.severity))}</span>
        <strong>${escapeHtml(w.title)}</strong>
      </div>
      <p class="entity-foundation-warnings__item-detail">${escapeHtml(w.detail)}</p>
      <p class="entity-foundation-warnings__item-action"><em>Recommended:</em> ${escapeHtml(w.recommended_action)}</p>
    </li>
  `;
}

export function renderInterCompanyMovements(
  body: HTMLElement,
  response: InterCompanyMovementsResponse,
): void {
  if (response.total === 0) {
    body.innerHTML = `
      <p class="inter-company-movements__empty">
        No inter-company movements detected. Transfers between the UK
        Ltd and the UAE FZCO accounts will show up here once they
        appear in the ledger.
      </p>
    `;
    return;
  }

  body.innerHTML = `
    <div class="inter-company-movements__summary">
      ${response.classified} of ${response.total} pair${response.total === 1 ? '' : 's'} classified
      (${response.unclassified} outstanding).
    </div>
    <ul class="inter-company-movements__list">
      ${response.pairs.map(renderPairRow).join('')}
    </ul>
  `;
}

function renderPairRow(pair: InterCompanyMovementPair): string {
  const status = pair.classification === null ? 'unclassified' : 'classified';
  const statusLabel = pair.classification === null ? 'Unclassified' : pair.classification;
  return `
    <li
      class="inter-company-movements__row"
      data-expense-hash="${escapeHtml(pair.expense.hash)}"
      data-income-hash="${escapeHtml(pair.income.hash)}"
      data-status="${status}"
    >
      <div class="inter-company-movements__sides">
        ${renderPairSide('Expense', pair.expense)}
        <span class="inter-company-movements__arrow" aria-hidden="true">→</span>
        ${renderPairSide('Income', pair.income)}
      </div>
      <div class="inter-company-movements__controls">
        <span class="inter-company-movements__status" data-status="${status}">${escapeHtml(statusLabel)}</span>
        <label class="inter-company-movements__control">
          <span class="inter-company-movements__label">Classification</span>
          <select class="inter-company-movements__select" data-role="category">
            <option value="">Unclassified</option>
            ${INTER_COMPANY_CATEGORIES.map(cat => `
              <option value="${escapeHtml(cat)}" ${cat === pair.classification ? 'selected' : ''}>
                ${escapeHtml(cat)}
              </option>
            `).join('')}
          </select>
        </label>
        <button type="button" class="inter-company-movements__save" data-role="save">Save</button>
        <span class="inter-company-movements__feedback" data-role="feedback" role="status" aria-live="polite"></span>
      </div>
    </li>
  `;
}

function renderPairSide(
  label: string,
  side: InterCompanyMovementPair['expense'] | InterCompanyMovementPair['income'],
): string {
  const entityLabel = side.entityId === 'autonize-it-ltd'
    ? 'UK Ltd'
    : side.entityId === 'autonize-it-fzco'
      ? 'UAE FZCO'
      : 'Unknown';
  return `
    <div class="inter-company-movements__side" data-role="${label.toLowerCase()}">
      <div class="inter-company-movements__side-header">
        <span class="inter-company-movements__side-label">${escapeHtml(label)}</span>
        <span class="inter-company-movements__side-entity">${escapeHtml(entityLabel)}</span>
      </div>
      <div class="inter-company-movements__side-body">
        <div><strong>${escapeHtml(side.date)}</strong> · ${escapeHtml(side.account)}</div>
        <div class="inter-company-movements__side-amount">${formatAmount(side.amount, side.account)}</div>
        <div class="inter-company-movements__side-desc">${escapeHtml(side.description)}</div>
      </div>
    </div>
  `;
}

function formatAmount(amount: number, account: string): string {
  const currency = account === 'emirates-islamic' ? 'AED' : 'GBP';
  return `${amount < 0 ? '−' : ''}${currency} ${Math.abs(amount).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

async function handleMovementsClick(event: MouseEvent): Promise<void> {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>('button[data-role="save"]');
  if (button === null) return;
  const row = button.closest<HTMLElement>('.inter-company-movements__row');
  if (row === null) return;

  const expenseHash = row.dataset.expenseHash;
  const incomeHash = row.dataset.incomeHash;
  if (expenseHash === undefined || incomeHash === undefined) return;

  const select = row.querySelector<HTMLSelectElement>('select[data-role="category"]');
  const feedback = row.querySelector<HTMLElement>('[data-role="feedback"]');
  if (select === null) return;

  const raw = select.value;
  const category: CategoryName | null = raw === '' ? null : (raw as CategoryName);

  button.disabled = true;
  if (feedback !== null) feedback.textContent = 'Saving…';

  try {
    const refreshed = await classifyInterCompanyMovement({
      expenseHash,
      incomeHash,
      category,
      notes: null,
    });
    const body = document.getElementById(MOVEMENTS_BODY_ID);
    if (body !== null) renderInterCompanyMovements(body, refreshed);
    // Also refresh the aggregate entity-foundation warning count
    // since classifying/clearing a pair shifts it.
    await loadEntityFoundation();
  } catch (error) {
    console.error('Failed to classify inter-company pair:', error);
    if (feedback !== null) {
      feedback.textContent = error instanceof Error ? error.message : 'Save failed.';
      feedback.classList.add('inter-company-movements__feedback--error');
    }
    button.disabled = false;
  }
}

function severityRank(severity: WarningSeverity): number {
  switch (severity) {
    case 'critical': return 3;
    case 'warn': return 2;
    case 'info': return 1;
  }
}

function severityIcon(severity: WarningSeverity): string {
  switch (severity) {
    case 'critical': return '🚨';
    case 'warn': return '⚠️';
    case 'info': return 'ℹ️';
  }
}

function severityLabel(severity: WarningSeverity): string {
  switch (severity) {
    case 'critical': return 'Critical';
    case 'warn': return 'Warning';
    case 'info': return 'Info';
  }
}

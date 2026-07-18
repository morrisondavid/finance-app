/**
 * Warnings tab — list from `GET /api/warnings/entity-foundation` (and `/all`),
 * plus inter-company movement classification.
 */

import {
  fetchEntityFoundationWarnings,
  fetchInterCompanyMovements,
  classifyInterCompanyMovement,
} from '../utils/api';
import { escapeHtml } from '../utils/dom';
import { reconcileInvoicesFromWarnings } from './invoices.js';
import { getAccountConfig } from './state';
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

/** Invoice reconciler warnings that get a one-click CTA on the Invoices tab. */
const INVOICE_RECONCILE_CTA_CODES = new Set([
  'invoice-overdue',
  'invoice-unmatched-deposit',
  'invoice-reference-amount-mismatch',
  'invoice-reference-ambiguous',
]);

function invoiceIdFromWarning(w: EntityFoundationWarning): string | undefined {
  if (typeof w.context?.invoiceId === 'string' && w.context.invoiceId.trim() !== '') {
    return w.context.invoiceId.trim();
  }
  const source = w.sources.find(s => s.startsWith('invoice:'));
  if (source === undefined) return undefined;
  const id = source.slice('invoice:'.length).trim();
  return id === '' ? undefined : id;
}

function reconcileCtaHtml(w: EntityFoundationWarning): string {
  if (!INVOICE_RECONCILE_CTA_CODES.has(w.code)) return '';
  const invoiceId = invoiceIdFromWarning(w);
  const label = invoiceId !== undefined ? 'Match payment on Invoices tab' : 'Reconcile payments on Invoices tab';
  const invoiceAttr =
    invoiceId !== undefined
      ? ` data-invoice-id="${escapeHtml(invoiceId)}"`
      : '';
  return `<p class="entity-foundation-warnings__item-cta"><button type="button" class="btn btn-sm" data-warning-action="reconcile-invoices"${invoiceAttr}>${escapeHtml(label)}</button></p>`;
}

/** Cached last fetch so tab revisits do not refetch until `loadWarnings`. */
let cachedWarnings: readonly EntityFoundationWarning[] = [];

export function initWarnings(): void {
  const body = document.getElementById(MOVEMENTS_BODY_ID);
  if (body !== null) {
    body.addEventListener('click', handleMovementsClick);
  }
  const warningsHost = document.getElementById(WARNINGS_CONTAINER_ID);
  if (warningsHost !== null) {
    warningsHost.addEventListener('click', handleWarningsClick);
  }
}

async function handleWarningsClick(event: MouseEvent): Promise<void> {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest<HTMLButtonElement>('button[data-warning-action="reconcile-invoices"]');
  if (btn === null) return;
  const invoiceId = btn.dataset.invoiceId?.trim();
  btn.disabled = true;
  try {
    await reconcileInvoicesFromWarnings(invoiceId === '' ? undefined : invoiceId);
  } finally {
    btn.disabled = false;
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
    cachedWarnings = response.warnings;
    rerenderCachedWarnings();
    if (emptyState) {
      emptyState.hidden = cachedWarnings.length > 0;
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

function rerenderCachedWarnings(): void {
  const container = document.getElementById(WARNINGS_CONTAINER_ID);
  if (!container) return;
  renderWarnings(container, cachedWarnings);
  const emptyState = document.getElementById(EMPTY_STATE_ID);
  if (emptyState) {
    emptyState.hidden = cachedWarnings.length > 0;
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

  const headerHtml = `
    <header class="entity-foundation-warnings__header">
      <span class="entity-foundation-warnings__icon" aria-hidden="true">${severityIcon(highest)}</span>
      <h3 class="entity-foundation-warnings__title">${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}</h3>
    </header>
  `;

  container.innerHTML = `
    ${headerHtml}
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
      ${reconcileCtaHtml(w)}
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

  // Split the queue: unclassified pairs stay expanded at the top so
  // the user's eye lands on work that still needs attention; already-
  // classified pairs collapse into a `<details>` drawer so the list
  // visibly shrinks on save (fixes the "row doesn't disappear" UX
  // complaint). The API still returns both sets so the audit trail
  // remains intact — we're only hiding them in the DOM.
  const unclassified = response.pairs.filter(p => p.classification === null);
  const classified = response.pairs.filter(p => p.classification !== null);

  const unclassifiedSection = unclassified.length === 0
    ? `<p class="inter-company-movements__empty inter-company-movements__empty--done">
         All detected pairs have been classified. Nice.
       </p>`
    : `<ul class="inter-company-movements__list" data-role="unclassified">
         ${unclassified.map(renderPairRow).join('')}
       </ul>`;

  const classifiedSection = classified.length === 0
    ? ''
    : `<details class="inter-company-movements__classified-drawer">
         <summary>Show classified (${classified.length})</summary>
         <ul class="inter-company-movements__list inter-company-movements__list--classified" data-role="classified">
           ${classified.map(renderPairRow).join('')}
         </ul>
       </details>`;

  body.innerHTML = `
    <div class="inter-company-movements__summary">
      ${response.classified} of ${response.total} pair${response.total === 1 ? '' : 's'} classified
      (${response.unclassified} outstanding).
    </div>
    ${unclassifiedSection}
    ${classifiedSection}
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
  const currency = getAccountConfig(account).currency;
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
    // The row has been moved into the collapsed drawer (or removed if
    // re-set to Unclassified), so the Save button it was attached to
    // no longer exists. Flash a transient toast instead of writing
    // into a feedback span that was just re-rendered.
    showMovementsToast(category === null ? 'Cleared' : 'Saved');
  } catch (error) {
    console.error('Failed to classify inter-company pair:', error);
    if (feedback !== null) {
      feedback.textContent = error instanceof Error ? error.message : 'Save failed.';
      feedback.classList.add('inter-company-movements__feedback--error');
    }
    button.disabled = false;
  }
}

/**
 * Display a short-lived confirmation toast above the movements list.
 * Deliberately self-contained (no global toast framework yet) — if
 * one lands later this can be swapped out. Reuses a single element
 * keyed by `MOVEMENTS_TOAST_ID` so rapid saves don't stack.
 */
const MOVEMENTS_TOAST_ID = 'inter-company-movements-toast';

function showMovementsToast(message: string): void {
  const body = document.getElementById(MOVEMENTS_BODY_ID);
  if (body === null) return;

  let toast = document.getElementById(MOVEMENTS_TOAST_ID);
  if (toast === null) {
    toast = document.createElement('div');
    toast.id = MOVEMENTS_TOAST_ID;
    toast.className = 'inter-company-movements__toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    body.parentElement?.insertBefore(toast, body);
  }
  toast.textContent = message;
  toast.classList.remove('inter-company-movements__toast--hidden');
  toast.classList.add('inter-company-movements__toast--visible');

  const toastEl = toast;
  window.setTimeout(() => {
    toastEl.classList.remove('inter-company-movements__toast--visible');
    toastEl.classList.add('inter-company-movements__toast--hidden');
  }, 1800);
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

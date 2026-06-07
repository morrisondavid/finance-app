import { escapeHtml, openModal as openModalEl, closeModal as closeModalEl } from '../utils/dom';
import { formatCurrency, formatAccountName, formatIsoDateUkLong } from '../utils/formatting';
import { daysUntil, daysLabel, todayIsoLocal } from '../../../shared/iso-date.js';
import { ACCOUNTS, type EntityFoundationWarning } from '../../../shared/api-contracts';

type PersonId = 'david' | 'heena';

interface ObligationItem {
  id: string;
  source: string;
  type: string;
  name: string;
  entity: string;
  frequency: string;
  expectedAmount: number | null;
  dueDate: string | null;
  status: string;
  paidAmount: number | null;
  paidDate: string | null;
  paidFromAccount: string | null;
  paidFromTxHash?: string | null;
  notes: string | null;
  personId?: PersonId | null;
}

type UpcomingPaymentItem =
  | {
      kind: 'obligation';
      id: string;
      type: string;
      name: string;
      entity: string;
      expectedAmount: number | null;
      dueDate: string;
      status: string;
      source: string;
      personId?: PersonId | null;
    }
  | {
      kind: 'recurring';
      merchant: string;
      category: string;
      colour: string;
      logoUrl: string | null;
      amount: number;
      sourceAccount: string;
      nextExpectedDate: string;
    };

/**
 * True if an upcoming-item row is an auto-generated Self Assessment estimate.
 * Drives the "est." chip + explanatory subtext on the Obligations page.
 */
function isAutoSaEstimate(item: Extract<UpcomingPaymentItem, { kind: 'obligation' }>): boolean {
  return item.type === 'self-assessment' && item.source === 'auto';
}

interface DismissalItem {
  obligationId: string;
  reason: string | null;
  dismissedAt: string;
}

/**
 * Shape of a registry row as rendered. Dismissed rows don't live in the
 * `financial_obligations` table any more (the auto-seeder skipped them),
 * so we synthesise a lightweight "virtual" row from the dismissal record
 * and the original auto-id to surface them when "Show dismissed" is on.
 */
type RegistryRow = ObligationItem & { dismissed?: true };

let editingId: string | null = null;
let showCompleted = false;
let showDismissed = false;

function statusBadge(status: string): string {
  const colours: Record<string, string> = {
    paid: '#22c55e',
    confirmed: '#22c55e',
    unpaid: '#ef4444',
    overdue: '#ef4444',
    pending: '#eab308',
    'not-yet-due': '#3b82f6',
    'insufficient-data': '#6b7280',
  };
  const bg = colours[status] ?? '#94a3b8';
  return `<span class="obligations-status-badge" style="background:${bg}">${escapeHtml(status)}</span>`;
}

function upcomingItemDate(item: UpcomingPaymentItem): string {
  return item.kind === 'obligation' ? item.dueDate : item.nextExpectedDate;
}

/**
 * True when a Mark Paid / Undo action should be offered for this row.
 *
 * State overrides live in `obligation-state.csv` keyed by obligation id;
 * auto-seeded HMRC rows (ids prefixed `auto-`) are owned by the seeders
 * and cannot accept a user state override — the server rejects those
 * ids at the `/state` endpoint. So the UI only offers the action for
 * `source=manual` rows, which is equivalent but checked client-side so
 * the button never renders in the first place.
 */
function supportsStateOverride(o: ObligationItem): boolean {
  return o.source === 'manual';
}

function isPaidStatus(status: string): boolean {
  return status === 'paid' || status === 'confirmed';
}

const TAX_RESERVE_WARNING_CODES = new Set([
  'tax-reserve-underfunded',
  'tax-reserve-trajectory-missing',
]);

function taxReserveDueDate(w: EntityFoundationWarning): string {
  const due = w.context?.dueDate;
  return typeof due === 'string' ? due : '9999-12-31';
}

function taxReserveSeverityRank(severity: EntityFoundationWarning['severity']): number {
  switch (severity) {
    case 'critical': return 3;
    case 'warn': return 2;
    case 'info': return 1;
  }
}

function taxReserveWarningsForLtd(
  warnings: readonly EntityFoundationWarning[],
): EntityFoundationWarning[] {
  return warnings.filter(
    w => TAX_RESERVE_WARNING_CODES.has(w.code) && w.entityId === 'autonize-it-ltd',
  );
}

function renderTaxReservePanel(warnings: readonly EntityFoundationWarning[]): void {
  const panel = document.getElementById('obligations-tax-reserve-panel');
  const list = document.getElementById('obligations-tax-reserve-list');
  if (!panel || !list) return;

  const taxWarnings = taxReserveWarningsForLtd(warnings);
  if (taxWarnings.length === 0) {
    panel.style.display = 'none';
    panel.hidden = true;
    list.innerHTML = '';
    return;
  }

  const sorted = [...taxWarnings].sort((a, b) => {
    const dueCmp = taxReserveDueDate(a).localeCompare(taxReserveDueDate(b));
    if (dueCmp !== 0) return dueCmp;
    const sev = taxReserveSeverityRank(b.severity) - taxReserveSeverityRank(a.severity);
    if (sev !== 0) return sev;
    if (a.code === 'tax-reserve-underfunded' && b.code !== 'tax-reserve-underfunded') return -1;
    if (b.code === 'tax-reserve-underfunded' && a.code !== 'tax-reserve-underfunded') return 1;
    return 0;
  });

  panel.style.display = '';
  panel.hidden = false;
  list.innerHTML = sorted.map(w => `
    <div class="obligations-tax-reserve-item" data-severity="${escapeHtml(w.severity)}">
      <strong>${escapeHtml(w.title)}</strong>
      <p>${escapeHtml(w.detail)}</p>
      <p class="obligations-tax-reserve-action"><em>Recommended:</em> ${escapeHtml(w.recommended_action)}</p>
    </div>
  `).join('');
}

function renderOverdue(obligations: ObligationItem[]): void {
  const panel = document.getElementById('obligations-overdue-panel');
  const list = document.getElementById('obligations-overdue-list');
  if (!panel || !list) return;

  if (obligations.length === 0) {
    panel.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  panel.style.display = '';
  const rows = obligations.map(o => {
    const days = o.dueDate ? Math.abs(daysUntil(o.dueDate)) : 0;
    const action = supportsStateOverride(o)
      ? `<button type="button" class="btn btn-sm obligations-mark-paid-btn" data-id="${escapeHtml(o.id)}">Mark paid</button>`
      : '';
    return `
      <div class="obligations-overdue-item">
        <div>
          <strong>${escapeHtml(o.name)}</strong>
          <span class="obligations-overdue-entity">${escapeHtml(o.entity)}</span>
        </div>
        <div class="obligations-overdue-amount">${o.expectedAmount !== null ? formatCurrency(o.expectedAmount) : '—'}</div>
        <div class="obligations-overdue-due">Due ${o.dueDate ? escapeHtml(formatIsoDateUkLong(o.dueDate)) : '—'}</div>
        <div class="obligations-overdue-days">${days} ${days === 1 ? 'day' : 'days'} overdue</div>
        <div class="obligations-overdue-actions">${action}</div>
      </div>`;
  }).join('');

  list.innerHTML = rows;

  list.querySelectorAll<HTMLButtonElement>('.obligations-mark-paid-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (!id) return;
      const obligation = obligations.find(o => o.id === id);
      if (obligation) void handleMarkPaid(obligation);
    });
  });
}

function renderUpcomingPayments(items: UpcomingPaymentItem[]): void {
  const container = document.getElementById('obligations-upcoming-list');
  const countBadge = document.getElementById('obligations-upcoming-count');
  if (!container) return;
  if (countBadge) countBadge.textContent = items.length > 0 ? String(items.length) : '';

  if (items.length === 0) {
    container.innerHTML = '<p class="obligations-empty">No upcoming payments.</p>';
    return;
  }

  // Uniform 4-column grid (info / amount / due / days) mirroring the
  // overdue hero. The hero itself is the warning signal — no per-row
  // urgency colours, status badges, or kind chips, all of which competed
  // with the amber ground and diluted the "things I need to worry about"
  // read.
  const rows = items.map(item => {
    const date = upcomingItemDate(item);
    const days = daysUntil(date);

    if (item.kind === 'obligation') {
      const isEstimate = isAutoSaEstimate(item);
      const estChip = isEstimate
        ? '<span class="obligations-est-chip" title="Auto-generated Self Assessment estimate">est.</span>'
        : '';
      const subtext = isEstimate
        ? '<div class="obligations-upcoming-subtext">Your estimate. Add a manual obligation when you know the real figure.</div>'
        : '';
      const addBtn = isEstimate
        ? `<button type="button" class="btn btn-sm obligations-sa-addmanual-btn"
             data-person-id="${escapeHtml(item.personId ?? '')}"
             data-due-date="${escapeHtml(item.dueDate)}">Add Obligation</button>`
        : '';

      return `
        <div class="obligations-upcoming-item">
          <div class="obligations-upcoming-info">
            <strong>${escapeHtml(item.name)}</strong>${estChip}
            <span class="obligations-upcoming-entity">${escapeHtml(item.entity)}</span>
            ${subtext}
            ${addBtn}
          </div>
          <div class="obligations-upcoming-amount">${item.expectedAmount !== null ? formatCurrency(item.expectedAmount) : '—'}</div>
          <div class="obligations-upcoming-due">Due ${escapeHtml(formatIsoDateUkLong(date))}</div>
          <div class="obligations-upcoming-days">${daysLabel(days)}</div>
        </div>`;
    }

    const logo = item.logoUrl
      ? `<img class="obligations-upcoming-logo" src="${escapeHtml(item.logoUrl)}" alt="${escapeHtml(item.merchant)} logo" />`
      : '';
    return `
      <div class="obligations-upcoming-item">
        <div class="obligations-upcoming-info">
          ${logo}
          <strong>${escapeHtml(item.merchant)}</strong>
          <span class="obligations-upcoming-entity"><span class="fixed-expenses-account-pill">${escapeHtml(item.sourceAccount)}</span></span>
        </div>
        <div class="obligations-upcoming-amount">${formatCurrency(item.amount)}</div>
        <div class="obligations-upcoming-due">Due ${escapeHtml(formatIsoDateUkLong(date))}</div>
        <div class="obligations-upcoming-days">${daysLabel(days)}</div>
      </div>`;
  }).join('');

  container.innerHTML = rows;

  container.querySelectorAll<HTMLButtonElement>('.obligations-sa-addmanual-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const personId = btn.dataset.personId ?? '';
      const dueDate = btn.dataset.dueDate ?? '';
      openSaPrefilledModal(personId, dueDate);
    });
  });
}

/**
 * Open the obligation modal with Self Assessment fields prefilled for the
 * given slot. Amount stays blank so the user types the HMRC figure — a
 * matching manual obligation will suppress the auto estimate on the next
 * page load.
 */
function openSaPrefilledModal(personId: string, dueDate: string): void {
  editingId = null;
  openModal('Add Self Assessment Obligation');
  const form = document.getElementById('obligations-form') as HTMLFormElement | null;
  if (!form) return;

  (form.elements.namedItem('type') as HTMLSelectElement).value = 'self-assessment';
  (form.elements.namedItem('frequency') as HTMLSelectElement).value = 'annual';
  const nameInput = form.elements.namedItem('name') as HTMLInputElement;
  nameInput.value = personId ? `Self Assessment — ${personId.charAt(0).toUpperCase()}${personId.slice(1)}` : 'Self Assessment';
  (form.elements.namedItem('entity') as HTMLInputElement).value = 'HMRC';
  (form.elements.namedItem('dueDate') as HTMLInputElement).value = dueDate;
  (form.elements.namedItem('expectedAmount') as HTMLInputElement).value = '';
  const personSelect = form.elements.namedItem('personId') as HTMLSelectElement | null;
  if (personSelect) personSelect.value = personId;
}

/**
 * Best-effort label for a synthesised dismissed row (see {@link buildDismissedVirtualRows}).
 * We only have the stable id prefix to work with; the original row was
 * discarded by the seeder once dismissed. Good enough for the "Show dismissed"
 * view — the user recognises what they hid.
 */
function humaniseDismissedId(obligationId: string): { name: string; type: string; entity: string; dueDate: string | null } {
  if (obligationId.startsWith('auto-sa-')) {
    const rest = obligationId.slice('auto-sa-'.length);
    const firstDash = rest.indexOf('-');
    const personId = firstDash >= 0 ? rest.slice(0, firstDash) : rest;
    const dueDate = firstDash >= 0 ? rest.slice(firstDash + 1) : null;
    const personLabel = personId ? `${personId.charAt(0).toUpperCase()}${personId.slice(1)}` : '';
    return {
      name: personLabel ? `Self Assessment — ${personLabel}` : 'Self Assessment',
      type: 'self-assessment',
      entity: 'HMRC',
      dueDate,
    };
  }
  if (obligationId.startsWith('auto-vat-')) {
    const dueDate = obligationId.slice('auto-vat-'.length) || null;
    return { name: 'VAT', type: 'vat', entity: 'HMRC', dueDate };
  }
  return { name: obligationId, type: 'unknown', entity: '—', dueDate: null };
}

function buildDismissedVirtualRows(dismissals: DismissalItem[]): RegistryRow[] {
  return dismissals.map(d => {
    const human = humaniseDismissedId(d.obligationId);
    return {
      id: d.obligationId,
      source: 'auto',
      type: human.type,
      name: human.name,
      entity: human.entity,
      frequency: human.type === 'vat' ? 'quarterly' : 'annual',
      expectedAmount: null,
      dueDate: human.dueDate,
      status: 'dismissed',
      paidAmount: null,
      paidDate: null,
      paidFromAccount: null,
      notes: d.reason,
      personId: null,
      dismissed: true,
    };
  });
}

function renderRegistry(obligations: ObligationItem[], dismissals: DismissalItem[] = []): void {
  const container = document.getElementById('obligations-registry-list');
  if (!container) return;

  const dismissedRows: RegistryRow[] = showDismissed ? buildDismissedVirtualRows(dismissals) : [];
  const allRows: RegistryRow[] = [...obligations, ...dismissedRows];

  if (allRows.length === 0) {
    container.innerHTML = '<p class="obligations-empty">No obligations tracked for this view.</p>';
    return;
  }

  const rows = allRows.map(o => {
    const isManual = o.source === 'manual';
    const isDismissed = o.dismissed === true;

    let actions: string;
    if (isDismissed) {
      // Dismissed auto rows only offer Undo — no editing, no second delete.
      actions = `<button type="button" class="btn btn-sm obligations-undismiss-btn" data-id="${escapeHtml(o.id)}">Undo</button>`;
    } else if (isManual) {
      // Mark Paid / Undo sits between Edit and Delete so the two
      // destructive-looking buttons (Delete, and Undo's confirm) aren't
      // adjacent — Undo only clears the state override, not the row, but
      // the visual grouping still matters for muscle memory.
      const stateBtn = isPaidStatus(o.status)
        ? `<button type="button" class="btn btn-sm obligations-undo-state-btn" data-id="${escapeHtml(o.id)}">Undo</button>`
        : `<button type="button" class="btn btn-sm obligations-mark-paid-btn" data-id="${escapeHtml(o.id)}">Mark paid</button>`;
      actions = `<button type="button" class="btn btn-sm obligations-edit-btn" data-id="${escapeHtml(o.id)}">Edit</button>
         ${stateBtn}
         <button type="button" class="btn btn-sm btn-danger obligations-delete-btn" data-id="${escapeHtml(o.id)}" data-source="manual">Delete</button>`;
    } else {
      // Auto row: keeps the same red `btn-danger` styling as the manual
      // Delete button (visual weight matches "this will remove the row")
      // but the label reads "Dismiss" because the click handler routes
      // to the dismissal API — the row is hidden with an Undo path, not
      // destroyed. The CSS selector class (obligations-delete-btn) and
      // data-source="auto" are intentionally unchanged: the wiring in
      // the click handler below keys off those, so only the label text
      // changes here.
      actions = `<button type="button" class="btn btn-sm btn-danger obligations-delete-btn" data-id="${escapeHtml(o.id)}" data-source="auto">Dismiss</button>`;
    }

    const accountPill = o.paidFromAccount
      ? o.paidFromAccount.split(', ').map(a => `<span class="fixed-expenses-account-pill">${escapeHtml(a)}</span>`).join(' ')
      : '—';

    const rowClass = isDismissed ? 'obligations-row-dismissed' : '';

    return `
      <tr class="${rowClass}">
        <td>${escapeHtml(o.name)}</td>
        <td>${escapeHtml(o.entity)}</td>
        <td>${escapeHtml(o.type)}</td>
        <td>${escapeHtml(o.frequency)}</td>
        <td class="obligations-col-amount">${o.expectedAmount !== null ? formatCurrency(o.expectedAmount) : '—'}</td>
        <td>${o.dueDate ? escapeHtml(formatIsoDateUkLong(o.dueDate)) : '—'}</td>
        <td class="obligations-col-amount">${o.paidAmount !== null ? formatCurrency(o.paidAmount) : '—'}</td>
        <td>${accountPill}</td>
        <td>${statusBadge(o.status)}</td>
        <td>${actions}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="obligations-table obligations-registry-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Entity</th>
          <th>Type</th>
          <th>Recurrence</th>
          <th class="obligations-col-amount">Expected</th>
          <th>Due Date</th>
          <th class="obligations-col-amount">Paid</th>
          <th>Paid From</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  container.querySelectorAll<HTMLButtonElement>('.obligations-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (id) openEditModal(id, obligations);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('.obligations-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const source = btn.dataset.source;
      if (!id) return;
      if (source === 'auto') {
        void handleDismiss(id);
      } else {
        void handleDelete(id);
      }
    });
  });

  container.querySelectorAll<HTMLButtonElement>('.obligations-undismiss-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (id) void handleUndismiss(id);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('.obligations-mark-paid-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (!id) return;
      const obligation = obligations.find(ob => ob.id === id);
      if (obligation) void handleMarkPaid(obligation);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('.obligations-undo-state-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (id) void handleUndoState(id);
    });
  });
}

function openModal(title: string): void {
  const titleEl = document.getElementById('obligations-modal-title');
  if (titleEl) titleEl.textContent = title;
  openModalEl('obligations-modal');
}

function closeModal(): void {
  const form = document.getElementById('obligations-form') as HTMLFormElement | null;
  if (form) form.reset();
  editingId = null;
  closeModalEl('obligations-modal');
}

function openEditModal(id: string, obligations: ObligationItem[]): void {
  const o = obligations.find(ob => ob.id === id);
  if (!o) return;
  editingId = id;
  openModal('Edit Obligation');
  const form = document.getElementById('obligations-form') as HTMLFormElement | null;
  if (!form) return;
  (form.elements.namedItem('type') as HTMLSelectElement).value = o.type;
  (form.elements.namedItem('name') as HTMLInputElement).value = o.name;
  (form.elements.namedItem('entity') as HTMLInputElement).value = o.entity;
  (form.elements.namedItem('frequency') as HTMLSelectElement).value = o.frequency;
  (form.elements.namedItem('expectedAmount') as HTMLInputElement).value = o.expectedAmount !== null ? String(o.expectedAmount) : '';
  (form.elements.namedItem('dueDate') as HTMLInputElement).value = o.dueDate ?? '';
  (form.elements.namedItem('notes') as HTMLTextAreaElement).value = o.notes ?? '';
  const personSelect = form.elements.namedItem('personId') as HTMLSelectElement | null;
  if (personSelect) personSelect.value = o.personId ?? '';
}

async function handleDelete(id: string): Promise<void> {
  if (!confirm('Delete this obligation?')) return;
  try {
    const resp = await fetch(`/api/obligations/${id}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error('Delete failed');
    await loadObligations();
  } catch (err) {
    console.error('[Obligations] Delete error:', err);
  }
}

/**
 * Dismiss an auto row. Softer confirm than manual delete: the row isn't
 * destroyed, it's hidden, and the Show dismissed toggle reveals an Undo
 * action — the confirm text tells the user that explicitly.
 */
async function handleDismiss(id: string): Promise<void> {
  if (!confirm('Dismiss this reminder? You can bring it back via "Show dismissed".')) return;
  try {
    const resp = await fetch('/api/obligations/dismissals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ obligationId: id }),
    });
    if (!resp.ok) throw new Error('Dismiss failed');
    await loadObligations();
  } catch (err) {
    console.error('[Obligations] Dismiss error:', err);
  }
}

interface PaymentCandidateItem {
  hash: string;
  date: string;
  amount: number;
  account: string;
  description: string;
}

interface MarkPaidChoice {
  paidFromTxHash: string | null;
}

function accountSelectOptions(): string {
  return ACCOUNTS
    .map(a => `<option value="${escapeHtml(a)}">${escapeHtml(formatAccountName(a))}</option>`)
    .join('');
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function yearSelectOptions(): string {
  const currentYear = new Date().getFullYear();
  const years: string[] = [];
  for (let y = currentYear + 1; y >= currentYear - 10; y--) {
    years.push(`<option value="${y}">${y}</option>`);
  }
  return years.join('');
}

function monthSelectOptions(): string {
  return MONTH_NAMES
    .map((name, i) => `<option value="${i + 1}">${name}</option>`)
    .join('');
}

function renderMarkPaidCandidateRow(c: PaymentCandidateItem): string {
  const dateLabel = formatIsoDateUkLong(c.date);
  const amountLabel = formatCurrency(Math.abs(c.amount));
  return `
    <label class="mark-paid-tx-row">
      <input type="radio" name="mark-paid-choice" value="${escapeHtml(c.hash)}" />
      <span class="mark-paid-tx-row-body">
        <span class="mark-paid-tx-row-main">${escapeHtml(dateLabel)} · ${amountLabel}</span>
        <span class="mark-paid-tx-row-desc">${escapeHtml(c.description)}</span>
      </span>
    </label>`;
}

function showMarkPaidDialog(obligation: ObligationItem): Promise<MarkPaidChoice | null> {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay mark-paid-overlay';
    overlay.style.display = 'flex';

    const amountLabel = obligation.expectedAmount !== null
      ? formatCurrency(obligation.expectedAmount)
      : '(no expected amount)';

    overlay.innerHTML = `
      <div class="modal modal-large mark-paid-modal" role="dialog" aria-labelledby="mark-paid-title">
        <div class="modal-header">
          <h3 id="mark-paid-title">Mark as paid</h3>
          <button type="button" class="modal-close" data-action="cancel">&times;</button>
        </div>
        <div class="modal-body">
          <div class="mark-paid-summary">
            <div class="mark-paid-summary-name">${escapeHtml(obligation.name)}</div>
            <div class="mark-paid-subtitle">Due ${obligation.dueDate ? escapeHtml(formatIsoDateUkLong(obligation.dueDate)) : '—'} · expected ${amountLabel}</div>
          </div>

          <fieldset class="mark-paid-filters">
            <legend>Find transaction</legend>
            <label class="mark-paid-filter-account">
              Account
              <select id="mark-paid-account" class="form-input">
                <option value="">Select account…</option>
                ${accountSelectOptions()}
              </select>
            </label>
            <div class="mark-paid-filter-period">
              <label>
                Year
                <select id="mark-paid-year" class="form-input">
                  <option value="">Select year…</option>
                  ${yearSelectOptions()}
                </select>
              </label>
              <label>
                Month
                <select id="mark-paid-month" class="form-input">
                  <option value="">Select month…</option>
                  ${monthSelectOptions()}
                </select>
              </label>
            </div>
          </fieldset>

          <div id="mark-paid-results" class="mark-paid-results">
            <p class="form-hint">Select account, year, and month to list transactions — or mark as cash below.</p>
          </div>

          <fieldset class="mark-paid-cash-option">
            <legend>Or mark without a ledger link</legend>
            <label class="mark-paid-tx-row">
              <input type="radio" name="mark-paid-choice" value="" />
              <span class="mark-paid-tx-row-body">
                <span class="mark-paid-tx-row-main">Cash / in-person</span>
                <span class="mark-paid-tx-row-desc">Uses expected amount and today’s date — no bank transaction linked</span>
              </span>
            </label>
          </fieldset>
        </div>
        <div class="modal-footer mark-paid-footer">
          <button type="button" class="btn" data-action="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-action="confirm" disabled>Mark paid</button>
        </div>
      </div>
    `;

    const accountEl = overlay.querySelector('#mark-paid-account') as HTMLSelectElement;
    const yearEl = overlay.querySelector('#mark-paid-year') as HTMLSelectElement;
    const monthEl = overlay.querySelector('#mark-paid-month') as HTMLSelectElement;
    const resultsEl = overlay.querySelector('#mark-paid-results') as HTMLElement;
    const confirmBtn = overlay.querySelector('[data-action="confirm"]') as HTMLButtonElement;

    let loadSeq = 0;

    const cleanup = (): void => {
      overlay.remove();
    };

    const filtersReady = (): boolean =>
      accountEl.value.trim() !== '' && yearEl.value !== '' && monthEl.value !== '';

    const clearTransactionSelection = (): void => {
      overlay.querySelectorAll('input[name="mark-paid-choice"]').forEach(el => {
        (el as HTMLInputElement).checked = false;
      });
      updateConfirmEnabled();
    };

    const selectedHash = (): string | null => {
      const checked = overlay.querySelector('input[name="mark-paid-choice"]:checked') as HTMLInputElement | null;
      if (checked === null) return null;
      const v = checked.value.trim();
      return v === '' ? null : v;
    };

    const updateConfirmEnabled = (): void => {
      confirmBtn.disabled = overlay.querySelector('input[name="mark-paid-choice"]:checked') === null;
    };

    const renderCandidates = (candidates: PaymentCandidateItem[]): void => {
      if (candidates.length === 0) {
        resultsEl.innerHTML = '<p class="form-hint">No transactions for this account and month. Try another month or mark as cash below.</p>';
        return;
      }
      resultsEl.innerHTML = `
        <p class="form-hint">${candidates.length} transaction${candidates.length === 1 ? '' : 's'} — select the one that settled this obligation:</p>
        <div class="transactions-list mark-paid-tx-list">
          ${candidates.map(renderMarkPaidCandidateRow).join('')}
        </div>`;
    };

    const loadCandidates = async (): Promise<void> => {
      if (!filtersReady()) {
        resultsEl.innerHTML = '<p class="form-hint">Select account, year, and month to list transactions — or mark as cash below.</p>';
        clearTransactionSelection();
        return;
      }

      const seq = ++loadSeq;
      clearTransactionSelection();
      resultsEl.innerHTML = '<p class="form-hint">Loading…</p>';

      const params = new URLSearchParams({
        account: accountEl.value,
        year: yearEl.value,
        month: monthEl.value,
      });

      try {
        const resp = await fetch(
          `/api/obligations/${encodeURIComponent(obligation.id)}/payment-candidates?${params}`,
        );
        if (seq !== loadSeq) return;

        if (!resp.ok) {
          const errPayload = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
          throw new Error(errPayload.error ?? 'Failed to load transactions');
        }
        const data = await resp.json() as { candidates: PaymentCandidateItem[] };
        if (seq !== loadSeq) return;
        renderCandidates(data.candidates ?? []);
      } catch (err) {
        if (seq !== loadSeq) return;
        resultsEl.innerHTML = `<p class="error">${escapeHtml(err instanceof Error ? err.message : 'Failed to load transactions')}</p>`;
      }
    };

    accountEl.addEventListener('change', () => { void loadCandidates(); });
    yearEl.addEventListener('change', () => { void loadCandidates(); });
    monthEl.addEventListener('change', () => { void loadCandidates(); });

    overlay.addEventListener('change', e => {
      if ((e.target as HTMLElement).matches('input[name="mark-paid-choice"]')) {
        updateConfirmEnabled();
      }
    });

    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });

    overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    overlay.querySelector('.modal-close')?.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    confirmBtn.addEventListener('click', () => {
      if (confirmBtn.disabled) return;
      const hash = selectedHash();
      cleanup();
      resolve({ paidFromTxHash: hash });
    });

    document.body.appendChild(overlay);
  });
}

/**
 * Mark a manual obligation as paid. Optionally link a bank transaction
 * (`paidFromTxHash`); when linked, paid amount/date/account are derived
 * server-side from the ledger row.
 */
async function handleMarkPaid(obligation: ObligationItem): Promise<void> {
  const choice = await showMarkPaidDialog(obligation);
  if (choice === null) return;

  const body: {
    status: string;
    paidFromTxHash?: string | null;
    paidAmount?: number | null;
    paidDate?: string | null;
    paidFromAccount?: string | null;
  } = { status: 'paid' };

  if (choice.paidFromTxHash !== null) {
    body.paidFromTxHash = choice.paidFromTxHash;
  } else {
    body.paidAmount = obligation.expectedAmount;
    body.paidDate = todayIsoLocal();
    body.paidFromAccount = null;
    body.paidFromTxHash = null;
  }

  try {
    const resp = await fetch(`/api/obligations/${encodeURIComponent(obligation.id)}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errPayload = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
      throw new Error(errPayload.error ?? 'Mark paid failed');
    }
    await loadObligations();
  } catch (err) {
    console.error('[Obligations] Mark paid error:', err);
    alert(err instanceof Error ? err.message : 'Mark paid failed');
  }
}

/**
 * Reset any state override on a manual obligation so it reverts to the
 * default projection — undoes a Mark Paid, including ones applied by the
 * auto-matcher (source=auto rows get cleared too, by design: if the user
 * clicks Undo on a paid insurance row, they want the "not paid" state
 * back, not the matcher immediately overwriting it on the next tick).
 * Database-initialisation re-runs the matcher, so if the match was
 * correct the row will flip back to paid — otherwise the user has
 * cleared a false positive.
 */
async function handleUndoState(id: string): Promise<void> {
  if (!confirm('Undo the paid status on this obligation?')) return;
  try {
    const resp = await fetch(`/api/obligations/${encodeURIComponent(id)}/state`, { method: 'DELETE' });
    if (!resp.ok) {
      const errPayload = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
      throw new Error(errPayload.error ?? 'Undo failed');
    }
    await loadObligations();
  } catch (err) {
    console.error('[Obligations] Undo error:', err);
    alert(err instanceof Error ? err.message : 'Undo failed');
  }
}

async function handleUndismiss(id: string): Promise<void> {
  try {
    const resp = await fetch(`/api/obligations/dismissals/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error('Undismiss failed');
    await loadObligations();
  } catch (err) {
    console.error('[Obligations] Undismiss error:', err);
  }
}

async function handleFormSubmit(e: Event): Promise<void> {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const personSelect = form.elements.namedItem('personId') as HTMLSelectElement | null;
  const personIdRaw = personSelect?.value ?? '';
  const data = {
    type: (form.elements.namedItem('type') as HTMLSelectElement).value,
    name: (form.elements.namedItem('name') as HTMLInputElement).value,
    entity: (form.elements.namedItem('entity') as HTMLInputElement).value,
    frequency: (form.elements.namedItem('frequency') as HTMLSelectElement).value,
    expectedAmount: (form.elements.namedItem('expectedAmount') as HTMLInputElement).value
      ? Number((form.elements.namedItem('expectedAmount') as HTMLInputElement).value) : null,
    dueDate: (form.elements.namedItem('dueDate') as HTMLInputElement).value || null,
    notes: (form.elements.namedItem('notes') as HTMLTextAreaElement).value || null,
    personId: personIdRaw === '' ? null : personIdRaw,
  };

  try {
    const url = editingId ? `/api/obligations/${editingId}` : '/api/obligations';
    const method = editingId ? 'PUT' : 'POST';
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!resp.ok) throw new Error('Save failed');
    closeModal();
    await loadObligations();
  } catch (err) {
    console.error('[Obligations] Save error:', err);
  }
}

export function initObligations(): void {
  const addBtn = document.getElementById('obligations-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      editingId = null;
      openModal('Add Obligation');
    });
  }

  const closeBtn = document.getElementById('obligations-modal-close');
  const cancelBtn = document.getElementById('obligations-modal-cancel');
  const modal = document.getElementById('obligations-modal');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  const form = document.getElementById('obligations-form');
  if (form) form.addEventListener('submit', (e) => void handleFormSubmit(e));

  const showCompletedToggle = document.getElementById('obligations-show-completed') as HTMLInputElement | null;
  if (showCompletedToggle) {
    showCompletedToggle.addEventListener('change', () => {
      showCompleted = showCompletedToggle.checked;
      void loadRegistry();
    });
  }

  const showDismissedToggle = document.getElementById('obligations-show-dismissed') as HTMLInputElement | null;
  if (showDismissedToggle) {
    showDismissedToggle.addEventListener('change', () => {
      showDismissed = showDismissedToggle.checked;
      void loadRegistry();
    });
  }
}

function buildRegistryUrl(): string {
  // Window filtering is applied server-side on every call to this endpoint,
  // so the client only needs to pass the completion toggle.
  const params = new URLSearchParams();
  if (!showCompleted) params.set('hideCompleted', '1');
  const qs = params.toString();
  return qs ? `/api/obligations?${qs}` : '/api/obligations';
}

async function fetchDismissalsIfToggled(): Promise<DismissalItem[]> {
  if (!showDismissed) return [];
  try {
    const resp = await fetch('/api/obligations/dismissals');
    if (!resp.ok) return [];
    const data = await resp.json() as { dismissals: DismissalItem[] };
    return data.dismissals ?? [];
  } catch (err) {
    console.error('[Obligations] Dismissals fetch error:', err);
    return [];
  }
}

async function loadRegistry(): Promise<void> {
  const [resp, dismissals] = await Promise.all([
    fetch(buildRegistryUrl()),
    fetchDismissalsIfToggled(),
  ]);
  if (!resp.ok) return;
  const data = await resp.json() as { obligations: ObligationItem[] };
  renderRegistry(data.obligations, dismissals);
}

export async function loadObligations(): Promise<void> {
  try {
    const [overdueResp, upcomingResp, registryResp, dismissals, warningsResp] = await Promise.all([
      fetch('/api/obligations/overdue'),
      fetch('/api/obligations/upcoming-payments?days=365'),
      fetch(buildRegistryUrl()),
      fetchDismissalsIfToggled(),
      fetch('/api/warnings/entity-foundation'),
    ]);

    if (overdueResp.ok) {
      const overdueData = await overdueResp.json() as { obligations: ObligationItem[] };
      renderOverdue(overdueData.obligations);
    }
    if (upcomingResp.ok) {
      const upcomingData = await upcomingResp.json() as { items: UpcomingPaymentItem[] };
      renderUpcomingPayments(upcomingData.items);
    }
    if (registryResp.ok) {
      const registryDataJson = await registryResp.json() as { obligations: ObligationItem[] };
      renderRegistry(registryDataJson.obligations, dismissals);
    }
    if (warningsResp.ok) {
      const warningsData = await warningsResp.json() as { warnings: EntityFoundationWarning[] };
      renderTaxReservePanel(warningsData.warnings);
    } else {
      renderTaxReservePanel([]);
    }
  } catch (error) {
    console.error('[Obligations] Error loading data:', error);
  }
}

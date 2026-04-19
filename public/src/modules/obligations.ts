import { escapeHtml } from '../utils/dom';
import { formatCurrency, formatIsoDateUkLong } from '../utils/formatting';

type PersonId = 'david' | 'heena';

interface ObligationItem {
  id: string;
  source: string;
  type: string;
  name: string;
  entity: string;
  recurrence: string;
  expectedAmount: number | null;
  dueDate: string | null;
  status: string;
  paidAmount: number | null;
  paidDate: string | null;
  paidFromAccount: string | null;
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

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function daysLabel(days: number): string {
  if (days < 0) {
    const n = Math.abs(days);
    return `${n} ${n === 1 ? 'day' : 'days'} overdue`;
  }
  if (days === 0) return 'Today';
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function upcomingItemDate(item: UpcomingPaymentItem): string {
  return item.kind === 'obligation' ? item.dueDate : item.nextExpectedDate;
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
    return `
      <div class="obligations-overdue-item">
        <div>
          <strong>${escapeHtml(o.name)}</strong>
          <span class="obligations-overdue-entity">${escapeHtml(o.entity)}</span>
        </div>
        <div class="obligations-overdue-amount">${o.expectedAmount !== null ? formatCurrency(o.expectedAmount) : '—'}</div>
        <div class="obligations-overdue-due">Due ${o.dueDate ? escapeHtml(formatIsoDateUkLong(o.dueDate)) : '—'}</div>
        <div class="obligations-overdue-days">${days} ${days === 1 ? 'day' : 'days'} overdue</div>
      </div>`;
  }).join('');

  list.innerHTML = rows;
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
  (form.elements.namedItem('recurrence') as HTMLSelectElement).value = 'annual';
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
      recurrence: human.type === 'vat' ? 'quarterly' : 'annual',
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
      actions = `<button type="button" class="btn btn-sm obligations-edit-btn" data-id="${escapeHtml(o.id)}">Edit</button>
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
        <td>${escapeHtml(o.recurrence)}</td>
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
}

function openModal(title: string): void {
  const modal = document.getElementById('obligations-modal');
  const titleEl = document.getElementById('obligations-modal-title');
  if (modal) modal.style.display = 'flex';
  if (titleEl) titleEl.textContent = title;
}

function closeModal(): void {
  const modal = document.getElementById('obligations-modal');
  const form = document.getElementById('obligations-form') as HTMLFormElement | null;
  if (modal) modal.style.display = 'none';
  if (form) form.reset();
  editingId = null;
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
  (form.elements.namedItem('recurrence') as HTMLSelectElement).value = o.recurrence;
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
    recurrence: (form.elements.namedItem('recurrence') as HTMLSelectElement).value,
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
    const [overdueResp, upcomingResp, registryResp, dismissals] = await Promise.all([
      fetch('/api/obligations/overdue'),
      fetch('/api/obligations/upcoming-payments?days=365'),
      fetch(buildRegistryUrl()),
      fetchDismissalsIfToggled(),
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
  } catch (error) {
    console.error('[Obligations] Error loading data:', error);
  }
}

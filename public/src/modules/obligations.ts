import { escapeHtml } from '../utils/dom';
import { formatCurrency } from '../utils/formatting';
import { getCurrentFinancialYearLabel, shiftFinancialYear } from '../utils/financial-year';

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

/** Items due within this many days (inclusive) are visually highlighted. */
const URGENT_WINDOW_DAYS = 14;

let editingId: string | null = null;
let showCompleted = false;
let selectedFinancialYear: string = getCurrentFinancialYearLabel();

function statusBadge(status: string): string {
  const colours: Record<string, string> = {
    paid: '#22c55e',
    confirmed: '#22c55e',
    unpaid: '#ef4444',
    overdue: '#ef4444',
    underpaid: '#f97316',
    pending: '#eab308',
    'not-yet-due': '#3b82f6',
    'no-income': '#94a3b8',
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

function urgencyClass(days: number): string {
  if (days < 0) return 'obligations-urgency-overdue';
  if (days <= URGENT_WINDOW_DAYS) return 'urgent';
  if (days < 30) return 'obligations-urgency-warning';
  return 'obligations-urgency-ok';
}

function daysLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Today';
  return `${days}d`;
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
        <div class="obligations-overdue-due">Due ${o.dueDate ?? '—'}</div>
        <div class="obligations-overdue-days">${days}d overdue</div>
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

  const rows = items.map(item => {
    const date = upcomingItemDate(item);
    const days = daysUntil(date);
    const cls = urgencyClass(days);

    if (item.kind === 'obligation') {
      return `
        <div class="obligations-upcoming-item ${cls}">
          <div class="obligations-upcoming-info">
            <strong>${escapeHtml(item.name)}</strong>
            <span class="obligations-upcoming-entity">${escapeHtml(item.entity)}</span>
          </div>
          <div class="obligations-upcoming-amount">${item.expectedAmount !== null ? formatCurrency(item.expectedAmount) : '—'}</div>
          <div class="obligations-upcoming-due">${date}</div>
          <div class="obligations-upcoming-days">${daysLabel(days)}</div>
          ${statusBadge(item.status)}
        </div>`;
    }

    const logo = item.logoUrl
      ? `<img class="obligations-upcoming-logo" src="${escapeHtml(item.logoUrl)}" alt="${escapeHtml(item.merchant)} logo" />`
      : '';
    return `
      <div class="obligations-upcoming-item ${cls}">
        <div class="obligations-upcoming-info">
          ${logo}
          <strong>${escapeHtml(item.merchant)}</strong>
          <span class="obligations-upcoming-entity"><span class="fixed-expenses-account-pill">${escapeHtml(item.sourceAccount)}</span></span>
        </div>
        <div class="obligations-upcoming-amount">${formatCurrency(item.amount)}</div>
        <div class="obligations-upcoming-due">${date}</div>
        <div class="obligations-upcoming-days">${daysLabel(days)}</div>
        <span class="obligations-upcoming-kind">annual</span>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="obligations-upcoming-grid">${rows}</div>`;
}

function renderRegistry(obligations: ObligationItem[]): void {
  const container = document.getElementById('obligations-registry-list');
  if (!container) return;

  if (obligations.length === 0) {
    container.innerHTML = '<p class="obligations-empty">No obligations tracked for this view.</p>';
    return;
  }

  const rows = obligations.map(o => {
    const isManual = o.source === 'manual';
    const actions = isManual
      ? `<button type="button" class="btn btn-sm obligations-edit-btn" data-id="${escapeHtml(o.id)}">Edit</button>
         <button type="button" class="btn btn-sm btn-danger obligations-delete-btn" data-id="${escapeHtml(o.id)}">Delete</button>`
      : '<span class="obligations-auto-label">auto</span>';

    const accountPill = o.paidFromAccount
      ? o.paidFromAccount.split(', ').map(a => `<span class="fixed-expenses-account-pill">${escapeHtml(a)}</span>`).join(' ')
      : '—';

    return `
      <tr>
        <td>${escapeHtml(o.name)}</td>
        <td>${escapeHtml(o.entity)}</td>
        <td>${escapeHtml(o.type)}</td>
        <td>${escapeHtml(o.recurrence)}</td>
        <td class="obligations-col-amount">${o.expectedAmount !== null ? formatCurrency(o.expectedAmount) : '—'}</td>
        <td>${o.dueDate ?? '—'}</td>
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
      if (id) void handleDelete(id);
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

async function handleFormSubmit(e: Event): Promise<void> {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const data = {
    type: (form.elements.namedItem('type') as HTMLSelectElement).value,
    name: (form.elements.namedItem('name') as HTMLInputElement).value,
    entity: (form.elements.namedItem('entity') as HTMLInputElement).value,
    recurrence: (form.elements.namedItem('recurrence') as HTMLSelectElement).value,
    expectedAmount: (form.elements.namedItem('expectedAmount') as HTMLInputElement).value
      ? Number((form.elements.namedItem('expectedAmount') as HTMLInputElement).value) : null,
    dueDate: (form.elements.namedItem('dueDate') as HTMLInputElement).value || null,
    notes: (form.elements.namedItem('notes') as HTMLTextAreaElement).value || null,
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

function updateFySelectorUI(): void {
  const wrap = document.getElementById('obligations-fy-selector');
  const label = document.getElementById('obligations-fy-label');
  if (wrap) wrap.style.display = showCompleted ? '' : 'none';
  if (label) label.textContent = selectedFinancialYear;
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
      if (showCompleted && !selectedFinancialYear) {
        selectedFinancialYear = getCurrentFinancialYearLabel();
      }
      updateFySelectorUI();
      void loadRegistry();
    });
  }

  const fyPrev = document.getElementById('obligations-fy-prev');
  const fyNext = document.getElementById('obligations-fy-next');
  if (fyPrev) {
    fyPrev.addEventListener('click', () => {
      selectedFinancialYear = shiftFinancialYear(selectedFinancialYear, -1);
      updateFySelectorUI();
      void loadRegistry();
    });
  }
  if (fyNext) {
    fyNext.addEventListener('click', () => {
      selectedFinancialYear = shiftFinancialYear(selectedFinancialYear, 1);
      updateFySelectorUI();
      void loadRegistry();
    });
  }

  updateFySelectorUI();
}

function buildRegistryUrl(): string {
  const params = new URLSearchParams();
  if (!showCompleted) {
    params.set('hideCompleted', '1');
  } else if (selectedFinancialYear) {
    params.set('financialYear', selectedFinancialYear);
  }
  const qs = params.toString();
  return qs ? `/api/obligations?${qs}` : '/api/obligations';
}

async function loadRegistry(): Promise<void> {
  const resp = await fetch(buildRegistryUrl());
  if (!resp.ok) return;
  const data = await resp.json() as { obligations: ObligationItem[] };
  renderRegistry(data.obligations);
}

export async function loadObligations(): Promise<void> {
  try {
    const [overdueResp, upcomingResp, registryResp] = await Promise.all([
      fetch('/api/obligations/overdue'),
      fetch('/api/obligations/upcoming-payments?days=365'),
      fetch(buildRegistryUrl()),
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
      renderRegistry(registryDataJson.obligations);
    }
  } catch (error) {
    console.error('[Obligations] Error loading data:', error);
  }
}

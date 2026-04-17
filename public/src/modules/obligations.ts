import { escapeHtml } from '../utils/dom';
import { formatCurrency } from '../utils/formatting';

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

interface VatQuarterRow {
  quarterLabel: string;
  startDate: string;
  endDate: string;
  dueDate: string;
  quarter: number;
  expectedAmount: number;
  paidAmount: number;
  paidDate: string | null;
  paidFromAccount: string | null;
  status: string;
}

let editingId: string | null = null;
let showHistoricalVat = false;

function getCurrentFinancialYear(): string {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const year = now.getFullYear();
  const startYear = month < 4 ? year - 1 : year;
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

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
  if (days < 7) return 'obligations-urgency-critical';
  if (days < 30) return 'obligations-urgency-warning';
  return 'obligations-urgency-ok';
}

function renderUpcoming(obligations: ObligationItem[]): void {
  const container = document.getElementById('obligations-upcoming-list');
  const countBadge = document.getElementById('obligations-upcoming-count');
  if (!container) return;
  if (countBadge) countBadge.textContent = obligations.length > 0 ? String(obligations.length) : '';

  if (obligations.length === 0) {
    container.innerHTML = '<p class="obligations-empty">No upcoming deadlines in the next 90 days.</p>';
    return;
  }

  const rows = obligations.map(o => {
    const days = o.dueDate ? daysUntil(o.dueDate) : 999;
    const cls = urgencyClass(days);
    const daysLabel = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d`;
    return `
      <div class="obligations-upcoming-item ${cls}">
        <div class="obligations-upcoming-info">
          <strong>${escapeHtml(o.name)}</strong>
          <span class="obligations-upcoming-entity">${escapeHtml(o.entity)}</span>
        </div>
        <div class="obligations-upcoming-amount">${o.expectedAmount !== null ? formatCurrency(o.expectedAmount) : '—'}</div>
        <div class="obligations-upcoming-due">${o.dueDate ?? '—'}</div>
        <div class="obligations-upcoming-days">${daysLabel}</div>
        ${statusBadge(o.status)}
      </div>`;
  }).join('');

  container.innerHTML = `<div class="obligations-upcoming-grid">${rows}</div>`;
}

function renderVatReconciliation(quarters: VatQuarterRow[]): void {
  const container = document.getElementById('obligations-vat-table');
  if (!container) return;

  if (quarters.length === 0) {
    container.innerHTML = '<p class="obligations-empty">No VAT quarter data available. Upload income transactions to begin.</p>';
    return;
  }

  const rows = quarters.map(q => {
    const accountPill = q.paidFromAccount
      ? q.paidFromAccount.split(', ').map(a => `<span class="fixed-expenses-account-pill">${escapeHtml(a)}</span>`).join(' ')
      : '—';
    const rowClass = q.status === 'insufficient-data' ? ' class="obligations-row-insufficient"' : '';
    return `
      <tr${rowClass}>
        <td>${escapeHtml(q.quarterLabel)}</td>
        <td class="obligations-col-amount">${formatCurrency(q.expectedAmount)}</td>
        <td class="obligations-col-amount">${q.paidAmount > 0 ? formatCurrency(q.paidAmount) : '—'}</td>
        <td>${q.paidDate ?? '—'}</td>
        <td>${accountPill}</td>
        <td>${q.dueDate}</td>
        <td>${statusBadge(q.status)}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="obligations-table">
      <thead>
        <tr>
          <th>Quarter</th>
          <th class="obligations-col-amount">Expected</th>
          <th class="obligations-col-amount">Paid</th>
          <th>Paid Date</th>
          <th>Paid From</th>
          <th>Due Date</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRegistry(obligations: ObligationItem[]): void {
  const container = document.getElementById('obligations-registry-list');
  if (!container) return;

  if (obligations.length === 0) {
    container.innerHTML = '<p class="obligations-empty">No obligations tracked yet. Add one manually or upload transactions for auto-detection.</p>';
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

  const toggle = document.getElementById('vat-show-historical') as HTMLInputElement | null;
  if (toggle) {
    toggle.addEventListener('change', () => {
      showHistoricalVat = toggle.checked;
      void loadVatReconciliation();
    });
  }
}

async function loadVatReconciliation(): Promise<void> {
  const vatUrl = showHistoricalVat
    ? '/api/obligations/vat-reconciliation'
    : `/api/obligations/vat-reconciliation?financialYear=${encodeURIComponent(getCurrentFinancialYear())}`;
  const vatResp = await fetch(vatUrl);
  if (vatResp.ok) {
    const vatData = await vatResp.json() as { quarters: VatQuarterRow[] };
    renderVatReconciliation(vatData.quarters);
  }
}

export async function loadObligations(): Promise<void> {
  try {
    const vatUrl = showHistoricalVat
      ? '/api/obligations/vat-reconciliation'
      : `/api/obligations/vat-reconciliation?financialYear=${encodeURIComponent(getCurrentFinancialYear())}`;

    const [upcomingResp, vatResp, allResp] = await Promise.all([
      fetch('/api/obligations/upcoming?days=90'),
      fetch(vatUrl),
      fetch('/api/obligations'),
    ]);

    if (upcomingResp.ok) {
      const upcomingData = await upcomingResp.json() as { obligations: ObligationItem[] };
      renderUpcoming(upcomingData.obligations);
    }
    if (vatResp.ok) {
      const vatData = await vatResp.json() as { quarters: VatQuarterRow[] };
      renderVatReconciliation(vatData.quarters);
    }
    if (allResp.ok) {
      const allData = await allResp.json() as { obligations: ObligationItem[] };
      renderRegistry(allData.obligations);
    }
  } catch (error) {
    console.error('[Obligations] Error loading data:', error);
  }
}

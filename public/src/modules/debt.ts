/**
 * Debt tab — shows per-creditor cards with derived current balance, matched
 * payments since opening, and a payoff progress bar. Full CRUD against
 * /api/debts (create, edit, archive, opening-balance PATCH).
 */

import { escapeHtml, escapeAttribute } from '../utils/dom';
import { formatCurrency, formatIsoDateUkLong, formatAccountName } from '../utils/formatting';
import { getState } from './state';
import type {
  DebtSummary,
  DebtSummariesResponse,
  DebtCreateBody,
  DebtUpdateBody,
  DebtOpeningBalanceBody,
  DebtResponse,
  AccountName,
} from '../../../shared/api-contracts.js';

interface DebtTabState {
  summaries: DebtSummary[];
  totalOutstanding: number;
  includeArchived: boolean;
  editingId: string | null;
  balanceEditingId: string | null;
  archivingId: string | null;
}

const tabState: DebtTabState = {
  summaries: [],
  totalOutstanding: 0,
  includeArchived: false,
  editingId: null,
  balanceEditingId: null,
  archivingId: null,
};

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function knownAccountNames(): string[] {
  const cfg = getState('accountConfig');
  return Object.keys(cfg).length > 0
    ? Object.keys(cfg)
    : ['barclays-current', 'barclays-savings', 'capital-on-tap', 'barclaycard', 'natwest', 'monzo-joint'];
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchDebts(): Promise<void> {
  const url = tabState.includeArchived ? '/api/debts?includeArchived=1' : '/api/debts';
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load debts: ${res.status}`);
  }
  const json = (await res.json()) as DebtSummariesResponse;
  tabState.summaries = json.debts;
  tabState.totalOutstanding = json.totalOutstanding;
}

function renderHero(): void {
  const totalEl = document.getElementById('debt-hero-total');
  const subEl = document.getElementById('debt-hero-sub');
  if (totalEl) totalEl.textContent = formatCurrency(tabState.totalOutstanding);
  const activeCount = tabState.summaries.filter(d => !d.archived).length;
  if (subEl) {
    subEl.textContent = `${activeCount} active creditor${activeCount === 1 ? '' : 's'}`;
  }
}

function renderCard(debt: DebtSummary): string {
  const pct = Math.round(debt.payoffProgress * 100);
  const paidTotal = Math.max(0, debt.originalLoanAmount - debt.currentBalance);
  const archivedBadge = debt.archived
    ? '<span class="debt-archived-badge">Archived</span>'
    : '';
  const lastPaymentLine =
    debt.lastPaymentDate && debt.lastPaymentAmount !== null
      ? `${formatCurrency(debt.lastPaymentAmount)} · ${formatIsoDateUkLong(debt.lastPaymentDate)}`
      : 'No payments matched yet';
  const originalLoanDateLine = debt.originalLoanDate
    ? ` · opened ${formatIsoDateUkLong(debt.originalLoanDate)}`
    : '';
  const accountsLine = debt.sourceAccounts
    .map(a => escapeHtml(formatAccountName(a)))
    .join(', ');

  return `
    <article class="debt-card ${debt.archived ? 'debt-card-archived' : ''}" data-debt-id="${escapeAttribute(debt.id)}">
      <header class="debt-card-header">
        <div class="debt-card-title">
          <h3>${escapeHtml(debt.name)}</h3>
          ${archivedBadge}
        </div>
        <div class="debt-card-actions">
          <button type="button" class="btn-small" data-debt-action="edit">Edit</button>
          <button type="button" class="btn-small btn-secondary" data-debt-action="archive">
            ${debt.archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </header>

      <div class="debt-card-balance">
        <span class="debt-card-balance-label">Current balance</span>
        <span class="debt-card-balance-value">${formatCurrency(debt.currentBalance)}</span>
        <span class="debt-card-balance-note">
          of ${formatCurrency(debt.originalLoanAmount)} original${originalLoanDateLine}
        </span>
      </div>

      <div class="debt-card-progress">
        <div class="debt-card-progress-bar">
          <div class="debt-card-progress-fill" style="width: ${pct}%"></div>
        </div>
        <div class="debt-card-progress-meta">
          <span>${formatCurrency(paidTotal)} paid</span>
          <span>${pct}%</span>
        </div>
      </div>

      <dl class="debt-card-facts">
        <div class="debt-card-fact debt-card-fact-clickable" data-debt-action="balance" title="Edit opening balance">
          <dt>Opening balance</dt>
          <dd>${formatCurrency(debt.openingBalance)} <span class="debt-card-fact-note">on ${formatIsoDateUkLong(debt.openingBalanceDate)}</span></dd>
        </div>
        <div class="debt-card-fact">
          <dt>Paid since opening</dt>
          <dd>${formatCurrency(debt.paidSinceOpening)} <span class="debt-card-fact-note">${debt.matchedTransactionCount} matched</span></dd>
        </div>
        <div class="debt-card-fact">
          <dt>Last payment</dt>
          <dd>${escapeHtml(lastPaymentLine)}</dd>
        </div>
        <div class="debt-card-fact">
          <dt>From</dt>
          <dd>${accountsLine}</dd>
        </div>
        <div class="debt-card-fact">
          <dt>Matches</dt>
          <dd><code>${escapeHtml(debt.merchantPattern)}</code></dd>
        </div>
      </dl>
    </article>
  `;
}

function renderCards(): void {
  const listEl = document.getElementById('debt-list');
  const emptyEl = document.getElementById('debt-empty');
  if (!listEl) return;
  if (tabState.summaries.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  listEl.innerHTML = tabState.summaries.map(renderCard).join('');

  listEl.querySelectorAll<HTMLElement>('[data-debt-action]').forEach(btn => {
    btn.addEventListener('click', event => {
      event.stopPropagation();
      const card = btn.closest<HTMLElement>('[data-debt-id]');
      if (!card) return;
      const id = card.dataset.debtId;
      const action = btn.dataset.debtAction;
      if (!id || !action) return;
      if (action === 'edit') openDebtEditModal(id);
      else if (action === 'archive') handleArchiveAction(id);
      else if (action === 'balance') openDebtBalanceModal(id);
    });
  });
}

function findDebt(id: string): DebtSummary | undefined {
  return tabState.summaries.find(d => d.id === id);
}

function handleArchiveAction(id: string): void {
  const debt = findDebt(id);
  if (!debt) return;
  if (debt.archived) {
    void unarchiveDebt(id);
  } else {
    openDebtArchiveModal(id);
  }
}

async function unarchiveDebt(id: string): Promise<void> {
  const body: DebtUpdateBody = { archived: false };
  const res = await fetch(`/api/debts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text();
    alert(`Failed to unarchive: ${msg}`);
    return;
  }
  await refresh();
}

// ---------------------------------------------------------------------------
// Create / Edit modal
// ---------------------------------------------------------------------------

function renderAccountsOptions(selected: readonly string[]): void {
  const container = document.getElementById('debt-edit-accounts-options');
  if (!container) return;
  const accounts = knownAccountNames();
  container.innerHTML = accounts
    .map(a => {
      const checked = selected.includes(a) ? 'checked' : '';
      return `
        <label class="debt-accounts-option">
          <input type="checkbox" name="sourceAccounts" value="${escapeAttribute(a)}" ${checked}>
          <span>${escapeHtml(formatAccountName(a))}</span>
        </label>
      `;
    })
    .join('');
}

function openDebtCreateModal(): void {
  tabState.editingId = null;
  const modal = document.getElementById('debt-edit-modal');
  const form = document.getElementById('debt-edit-form') as HTMLFormElement | null;
  const title = document.getElementById('debt-edit-modal-title');
  const idInput = form?.querySelector<HTMLInputElement>('input[name="id"]');
  if (!modal || !form || !idInput) return;

  form.reset();
  if (title) title.textContent = 'Add Debt';
  idInput.disabled = false;
  (form.querySelector<HTMLInputElement>('input[name="openingBalanceDate"]') as HTMLInputElement).value = todayIso();
  renderAccountsOptions([]);
  modal.style.display = 'flex';
}

function openDebtEditModal(id: string): void {
  const debt = findDebt(id);
  if (!debt) return;
  tabState.editingId = id;

  const modal = document.getElementById('debt-edit-modal');
  const form = document.getElementById('debt-edit-form') as HTMLFormElement | null;
  const title = document.getElementById('debt-edit-modal-title');
  if (!modal || !form) return;

  form.reset();
  if (title) title.textContent = `Edit ${debt.name}`;
  const idInput = form.querySelector<HTMLInputElement>('input[name="id"]')!;
  idInput.value = debt.id;
  idInput.disabled = true;
  (form.querySelector<HTMLInputElement>('input[name="name"]')!).value = debt.name;
  (form.querySelector<HTMLInputElement>('input[name="merchantPattern"]')!).value = debt.merchantPattern;
  (form.querySelector<HTMLInputElement>('input[name="originalLoanAmount"]')!).value = String(debt.originalLoanAmount);
  (form.querySelector<HTMLInputElement>('input[name="originalLoanDate"]')!).value = debt.originalLoanDate ?? '';
  (form.querySelector<HTMLInputElement>('input[name="openingBalance"]')!).value = String(debt.openingBalance);
  (form.querySelector<HTMLInputElement>('input[name="openingBalanceDate"]')!).value = debt.openingBalanceDate;
  renderAccountsOptions(debt.sourceAccounts);
  modal.style.display = 'flex';
}

function closeDebtEditModal(): void {
  const modal = document.getElementById('debt-edit-modal');
  if (modal) modal.style.display = 'none';
  tabState.editingId = null;
}

async function handleDebtEditSubmit(event: Event): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const fd = new FormData(form);

  const sourceAccounts = fd.getAll('sourceAccounts').map(v => String(v)) as AccountName[];
  if (sourceAccounts.length === 0) {
    alert('Select at least one source account.');
    return;
  }

  const originalLoanDateRaw = String(fd.get('originalLoanDate') ?? '').trim();

  if (tabState.editingId === null) {
    const idRaw = String(fd.get('id') ?? '').trim();
    if (!idRaw) {
      alert('ID is required.');
      return;
    }
    const body: DebtCreateBody = {
      id: idRaw,
      name: String(fd.get('name') ?? '').trim(),
      merchantPattern: String(fd.get('merchantPattern') ?? '').trim(),
      sourceAccounts,
      originalLoanAmount: Number(fd.get('originalLoanAmount')),
      originalLoanDate: originalLoanDateRaw === '' ? null : originalLoanDateRaw,
      openingBalance: Number(fd.get('openingBalance')),
      openingBalanceDate: String(fd.get('openingBalanceDate')),
    };
    const res = await fetch('/api/debts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      alert(`Failed to create: ${await res.text()}`);
      return;
    }
  } else {
    const body: DebtUpdateBody = {
      name: String(fd.get('name') ?? '').trim(),
      merchantPattern: String(fd.get('merchantPattern') ?? '').trim(),
      sourceAccounts,
      originalLoanAmount: Number(fd.get('originalLoanAmount')),
      originalLoanDate: originalLoanDateRaw === '' ? null : originalLoanDateRaw,
      openingBalance: Number(fd.get('openingBalance')),
      openingBalanceDate: String(fd.get('openingBalanceDate')),
    };
    const res = await fetch(`/api/debts/${encodeURIComponent(tabState.editingId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      alert(`Failed to update: ${await res.text()}`);
      return;
    }
  }

  closeDebtEditModal();
  await refresh();
}

// ---------------------------------------------------------------------------
// Opening-balance modal
// ---------------------------------------------------------------------------

function openDebtBalanceModal(id: string): void {
  const debt = findDebt(id);
  if (!debt) return;
  tabState.balanceEditingId = id;

  const modal = document.getElementById('debt-balance-modal');
  const form = document.getElementById('debt-balance-form') as HTMLFormElement | null;
  const sub = document.getElementById('debt-balance-modal-sub');
  if (!modal || !form) return;

  form.reset();
  if (sub) {
    sub.textContent = `Set opening balance for ${debt.name}. Matched payments after this date reduce the current balance.`;
  }
  (form.querySelector<HTMLInputElement>('input[name="balance"]')!).value = String(debt.openingBalance);
  (form.querySelector<HTMLInputElement>('input[name="date"]')!).value = debt.openingBalanceDate;
  modal.style.display = 'flex';
}

function closeDebtBalanceModal(): void {
  const modal = document.getElementById('debt-balance-modal');
  if (modal) modal.style.display = 'none';
  tabState.balanceEditingId = null;
}

async function handleDebtBalanceSubmit(event: Event): Promise<void> {
  event.preventDefault();
  if (tabState.balanceEditingId === null) return;
  const form = event.currentTarget as HTMLFormElement;
  const fd = new FormData(form);
  const body: DebtOpeningBalanceBody = {
    balance: Number(fd.get('balance')),
    date: String(fd.get('date')),
  };
  const res = await fetch(
    `/api/debts/${encodeURIComponent(tabState.balanceEditingId)}/opening-balance`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    alert(`Failed to set balance: ${await res.text()}`);
    return;
  }
  closeDebtBalanceModal();
  await refresh();
}

// ---------------------------------------------------------------------------
// Archive confirmation modal
// ---------------------------------------------------------------------------

function openDebtArchiveModal(id: string): void {
  const debt = findDebt(id);
  if (!debt) return;
  tabState.archivingId = id;
  const modal = document.getElementById('debt-archive-modal');
  const sub = document.getElementById('debt-archive-modal-sub');
  if (!modal) return;
  if (sub) {
    sub.textContent = `Archive "${debt.name}"? This hides it from the grid but keeps all matched transaction history. You can re-enable it later via "Show archived".`;
  }
  modal.style.display = 'flex';
}

function closeDebtArchiveModal(): void {
  const modal = document.getElementById('debt-archive-modal');
  if (modal) modal.style.display = 'none';
  tabState.archivingId = null;
}

async function confirmArchive(): Promise<void> {
  if (tabState.archivingId === null) return;
  const res = await fetch(`/api/debts/${encodeURIComponent(tabState.archivingId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    alert(`Failed to archive: ${await res.text()}`);
    return;
  }
  closeDebtArchiveModal();
  await refresh();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

async function refresh(): Promise<void> {
  try {
    await fetchDebts();
    renderHero();
    renderCards();
  } catch (err) {
    console.error('[Debt] load failed', err);
  }
}

export function initDebt(): void {
  document.getElementById('debt-add-btn')?.addEventListener('click', openDebtCreateModal);
  document.getElementById('debt-edit-modal-close')?.addEventListener('click', closeDebtEditModal);
  document.getElementById('debt-edit-cancel-btn')?.addEventListener('click', closeDebtEditModal);
  document.getElementById('debt-edit-form')?.addEventListener('submit', handleDebtEditSubmit);
  document.getElementById('debt-balance-modal-close')?.addEventListener('click', closeDebtBalanceModal);
  document.getElementById('debt-balance-cancel-btn')?.addEventListener('click', closeDebtBalanceModal);
  document.getElementById('debt-balance-form')?.addEventListener('submit', handleDebtBalanceSubmit);
  document.getElementById('debt-archive-modal-close')?.addEventListener('click', closeDebtArchiveModal);
  document.getElementById('debt-archive-cancel-btn')?.addEventListener('click', closeDebtArchiveModal);
  document.getElementById('debt-archive-confirm-btn')?.addEventListener('click', () => {
    void confirmArchive();
  });
  document
    .getElementById('debt-show-archived')
    ?.addEventListener('change', async event => {
      const target = event.currentTarget as HTMLInputElement;
      tabState.includeArchived = target.checked;
      await refresh();
    });

  // Auto-slug the id field from the name when creating a new debt.
  const form = document.getElementById('debt-edit-form') as HTMLFormElement | null;
  if (form) {
    const nameInput = form.querySelector<HTMLInputElement>('input[name="name"]');
    const idInput = form.querySelector<HTMLInputElement>('input[name="id"]');
    nameInput?.addEventListener('input', () => {
      if (!idInput || idInput.disabled) return;
      if (tabState.editingId !== null) return;
      idInput.value = slugify(nameInput.value);
    });
  }
}

export async function loadDebt(): Promise<void> {
  await refresh();
}

/** Re-export for type consumers outside this module. */
export type { DebtSummary, DebtResponse };

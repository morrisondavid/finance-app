/**
 * Deadlines tab — list + calendar views backed by the `/api/deadlines`
 * feed endpoint.
 *
 * Split of concerns inside this module:
 *   - `loadDeadlines()` fetches the unified feed, renders the list,
 *     and pushes the same data into FullCalendar.
 *   - `renderList()` bucketises via the shared urgency helper so the
 *     Obligations tab + Deadlines tab can never drift.
 *   - `showModal()` / `handleFormSubmit()` CRUD against `/api/deadlines`.
 *
 * FullCalendar is lazy-loaded the first time the calendar view is
 * shown — the library is ~100kb gzipped and 90% of sessions will never
 * open it.
 */

import { Calendar } from '@fullcalendar/core';
import type { EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import multiMonthPlugin from '@fullcalendar/multimonth';

import { escapeHtml, openModal, closeModal as closeModalEl } from '../utils/dom';
import { formatIsoDateUkLong } from '../utils/formatting';
import {
  daysUntil,
  daysLabel,
  todayIsoLocal,
} from '../../../shared/iso-date.js';
import {
  bucketItemsByUrgency,
  type UrgencyBucket,
  type UrgencyStatus,
} from '../../../shared/urgency.js';
import type {
  Deadline,
  DeadlineFeedItem,
  DeadlineType,
  DeadlineRecurrence,
} from '../../../shared/api-contracts.js';

type DeadlinesView = 'list' | 'calendar';

let currentView: DeadlinesView = 'list';
let showCompleted = false;
let editingId: string | null = null;
let calendar: Calendar | null = null;
let cachedFeed: DeadlineFeedItem[] = [];
let cachedDeadlines: Map<string, Deadline> = new Map();

const BUCKET_ORDER: readonly UrgencyBucket[] = [
  'overdue',
  'this-week',
  'this-month',
  'this-year',
  'later',
  'completed',
];

const BUCKET_LABELS: Record<UrgencyBucket, string> = {
  overdue: 'Overdue',
  'this-week': 'Due this week',
  'this-month': 'Due this month',
  'this-year': 'Due this year',
  later: 'Later',
  completed: 'Completed',
};

const STATUS_BG: Record<UrgencyStatus, string> = {
  overdue: '#ef4444',
  'due-soon': '#f97316',
  upcoming: '#3b82f6',
  completed: '#22c55e',
};

function statusBadge(status: UrgencyStatus): string {
  const bg = STATUS_BG[status];
  return `<span class="deadlines-status-badge" style="background:${bg}">${escapeHtml(status)}</span>`;
}

function sourceBadge(source: DeadlineFeedItem['source']): string {
  const label = source === 'obligation' ? 'Obligation' : 'Deadline';
  const cls = source === 'obligation' ? 'deadlines-source-obligation' : 'deadlines-source-deadline';
  return `<span class="deadlines-source-badge ${cls}">${label}</span>`;
}

/**
 * Convert a feed item into a row. Deadline rows get inline Done/Reopen +
 * Edit/Delete actions; obligation rows link out to the Obligations tab
 * so the user has a single authority for financial state changes.
 */
function rowHtml(item: DeadlineFeedItem): string {
  const days = daysUntil(item.dueDate);
  const label = item.completed && item.dueDate ? `Completed` : daysLabel(days);
  const actions: string[] = [];
  if (item.source === 'deadline') {
    const deadlineId = item.id.startsWith('deadline:') ? item.id.slice('deadline:'.length) : item.id;
    if (item.completed) {
      actions.push(`<button class="btn btn-small" data-deadline-action="reopen" data-id="${escapeHtml(deadlineId)}">Reopen</button>`);
    } else {
      actions.push(`<button class="btn btn-small" data-deadline-action="complete" data-id="${escapeHtml(deadlineId)}">Mark done</button>`);
    }
    actions.push(`<button class="btn btn-small" data-deadline-action="edit" data-id="${escapeHtml(deadlineId)}">Edit</button>`);
    actions.push(`<button class="btn btn-small btn-danger" data-deadline-action="delete" data-id="${escapeHtml(deadlineId)}">Delete</button>`);
  } else {
    actions.push(`<button class="btn btn-small" data-deadline-action="go-to-obligation">Open in Obligations</button>`);
  }

  const urlLink = item.url
    ? `<a class="deadlines-url" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">link</a>`
    : '';

  return `
    <li class="deadlines-row" data-id="${escapeHtml(item.id)}">
      <div class="deadlines-row-main">
        <div class="deadlines-row-title">${escapeHtml(item.title)}</div>
        <div class="deadlines-row-meta">
          ${sourceBadge(item.source)}
          ${statusBadge(item.status)}
          <span class="deadlines-row-date">${escapeHtml(formatIsoDateUkLong(item.dueDate))}</span>
          <span class="deadlines-row-days">${escapeHtml(label)}</span>
          ${urlLink}
        </div>
        ${item.notes ? `<div class="deadlines-row-notes">${escapeHtml(item.notes)}</div>` : ''}
      </div>
      <div class="deadlines-row-actions">${actions.join('')}</div>
    </li>
  `;
}

function renderList(items: DeadlineFeedItem[]): void {
  const listEl = document.getElementById('deadlines-list');
  if (!listEl) return;

  const visible = showCompleted ? items : items.filter(i => !i.completed);

  if (visible.length === 0) {
    listEl.innerHTML = `<div class="deadlines-empty">No deadlines yet. Click "+ Add deadline" to create one.</div>`;
    return;
  }

  const bucketed = bucketItemsByUrgency(visible, new Date());

  const sections = BUCKET_ORDER.filter(b => bucketed[b].length > 0 && (showCompleted || b !== 'completed')).map(
    bucket => {
      const rows = bucketed[bucket]
        .slice()
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .map(rowHtml)
        .join('');
      return `
        <section class="deadlines-bucket deadlines-bucket-${bucket}">
          <h3 class="deadlines-bucket-title">${escapeHtml(BUCKET_LABELS[bucket])} <span class="badge">${bucketed[bucket].length}</span></h3>
          <ul class="deadlines-bucket-list">${rows}</ul>
        </section>
      `;
    },
  );

  listEl.innerHTML = sections.join('');
}

function statusColorForCalendar(status: UrgencyStatus): string {
  return STATUS_BG[status];
}

function toEventInput(item: DeadlineFeedItem): EventInput {
  return {
    id: item.id,
    title: item.title,
    start: item.dueDate,
    allDay: true,
    backgroundColor: statusColorForCalendar(item.status),
    borderColor: statusColorForCalendar(item.status),
    textColor: '#ffffff',
    classNames: [
      `deadlines-event-${item.source}`,
      item.completed ? 'deadlines-event-completed' : 'deadlines-event-open',
    ],
    extendedProps: {
      source: item.source,
      status: item.status,
      type: item.type,
      notes: item.notes,
      url: item.url,
      completed: item.completed,
    },
  };
}

function ensureCalendar(): Calendar | null {
  const el = document.getElementById('deadlines-calendar');
  if (!el) return null;
  if (calendar) return calendar;

  calendar = new Calendar(el, {
    plugins: [dayGridPlugin, listPlugin, interactionPlugin, multiMonthPlugin],
    // Month view is the default: it focuses on the current month, which
    // is where most actionable deadlines sit. Year/Day/Agenda are one
    // click away in the toolbar, and double-clicking any day cell drills
    // straight into the dedicated day view.
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'multiMonthYear,dayGridMonth,dayGridDay,listMonth',
    },
    buttonText: {
      today: 'Today',
      month: 'Month',
      day: 'Day',
      list: 'Agenda',
      multiMonthYear: 'Year',
    },
    views: {
      // Year grid: 2 columns × 6 rows of mini-months. FullCalendar sizes
      // each mini-month as (100 / colCount)% of the container width, so
      // capping at 2 columns makes each tile fill half of whatever width
      // the card has (~600–680px at typical laptop widths). That's large
      // enough for the weekday headers, date numbers, and event chips to
      // all stay comfortably readable without changing the surrounding
      // card / container styling.
      multiMonthYear: {
        type: 'multiMonth',
        duration: { years: 1 },
        multiMonthMaxColumns: 2,
        multiMonthMinWidth: 320,
      },
    },
    height: 'auto',
    firstDay: 1,
    weekNumbers: false,
    eventClick(info) {
      const source = info.event.extendedProps.source as DeadlineFeedItem['source'];
      const feedId = info.event.id;
      if (source === 'deadline') {
        const deadlineId = feedId.startsWith('deadline:') ? feedId.slice('deadline:'.length) : feedId;
        const deadline = cachedDeadlines.get(deadlineId);
        if (deadline) openEditModal(deadline);
      }
    },
    // FullCalendar v6 has no native double-click on dates, but day cells
    // carry a `data-date` attribute we can lean on. Delegating on the
    // root container survives re-renders when the view or range changes.
    dateClick(info) {
      const jsEvent = info.jsEvent as MouseEvent;
      if (jsEvent.detail === 2) {
        drillToDay(info.dateStr);
      }
    },
  });
  calendar.render();
  attachDayCellDoubleClick(el);
  return calendar;
}

/**
 * Switch the calendar into the single-day grid view focused on the given
 * ISO date. Used by the double-click handler so the user can "zoom in"
 * from either the year view or the month view without hunting for the
 * right toolbar button.
 */
function drillToDay(isoDate: string): void {
  if (!calendar) return;
  calendar.changeView('dayGridDay', isoDate);
}

/**
 * Fallback double-click binding for browsers / interactions where
 * FullCalendar's `dateClick` does not fire with `detail === 2` (notably
 * the multi-month year view, whose mini-cells only emit `dateClick` on
 * the first click of a rapid pair). A delegated `dblclick` on the
 * container reliably catches both cases.
 */
function attachDayCellDoubleClick(root: HTMLElement): void {
  root.addEventListener('dblclick', e => {
    const target = e.target as HTMLElement | null;
    const cell = target?.closest<HTMLElement>('[data-date]');
    const iso = cell?.getAttribute('data-date');
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      drillToDay(iso);
    }
  });
}

function renderCalendar(items: DeadlineFeedItem[]): void {
  const cal = ensureCalendar();
  if (!cal) return;
  const visible = showCompleted ? items : items.filter(i => !i.completed);
  cal.removeAllEvents();
  cal.addEventSource(visible.map(toEventInput));
}

function setView(view: DeadlinesView): void {
  currentView = view;
  const listEl = document.getElementById('deadlines-view-list');
  const calEl = document.getElementById('deadlines-view-calendar');
  if (listEl) listEl.style.display = view === 'list' ? '' : 'none';
  if (calEl) calEl.style.display = view === 'calendar' ? '' : 'none';

  document.querySelectorAll<HTMLElement>('[data-deadlines-view]').forEach(btn => {
    const isActive = btn.dataset.deadlinesView === view;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  if (view === 'calendar') {
    const cal = ensureCalendar();
    if (cal) {
      cal.updateSize();
      renderCalendar(cachedFeed);
    }
  }
}

export async function loadDeadlines(): Promise<void> {
  try {
    const [feedResp, listResp] = await Promise.all([
      fetch('/api/deadlines/feed'),
      fetch('/api/deadlines'),
    ]);
    if (!feedResp.ok) throw new Error(`Feed HTTP ${feedResp.status}`);
    if (!listResp.ok) throw new Error(`List HTTP ${listResp.status}`);
    const feedPayload = (await feedResp.json()) as { items: DeadlineFeedItem[] };
    const listPayload = (await listResp.json()) as { deadlines: Deadline[] };
    cachedFeed = feedPayload.items;
    cachedDeadlines = new Map(listPayload.deadlines.map(d => [d.id, d]));
    renderList(cachedFeed);
    if (currentView === 'calendar') renderCalendar(cachedFeed);
  } catch (err) {
    console.error('[Deadlines] load error:', err);
    const listEl = document.getElementById('deadlines-list');
    if (listEl) {
      listEl.innerHTML = `<div class="deadlines-empty">Failed to load deadlines: ${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
    }
  }
}

function openCreateModal(): void {
  editingId = null;
  const form = document.getElementById('deadlines-form') as HTMLFormElement | null;
  const title = document.getElementById('deadlines-modal-title');
  if (!form || !title) return;
  title.textContent = 'Add deadline';
  form.reset();
  (form.elements.namedItem('dueDate') as HTMLInputElement).value = todayIsoLocal();
  openModal('deadlines-modal');
}

function openEditModal(d: Deadline): void {
  editingId = d.id;
  const form = document.getElementById('deadlines-form') as HTMLFormElement | null;
  const title = document.getElementById('deadlines-modal-title');
  if (!form || !title) return;
  title.textContent = 'Edit deadline';
  (form.elements.namedItem('title') as HTMLInputElement).value = d.title;
  (form.elements.namedItem('dueDate') as HTMLInputElement).value = d.dueDate;
  (form.elements.namedItem('type') as HTMLSelectElement).value = d.type;
  (form.elements.namedItem('recurrence') as HTMLSelectElement).value = d.recurrence;
  (form.elements.namedItem('url') as HTMLInputElement).value = d.url ?? '';
  (form.elements.namedItem('notes') as HTMLTextAreaElement).value = d.notes ?? '';
  openModal('deadlines-modal');
}

function closeModal(): void {
  closeModalEl('deadlines-modal');
  editingId = null;
}

function trimOrNull(value: string): string | null {
  const t = value.trim();
  return t === '' ? null : t;
}

async function handleFormSubmit(e: Event): Promise<void> {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const payload = {
    title: (form.elements.namedItem('title') as HTMLInputElement).value.trim(),
    dueDate: (form.elements.namedItem('dueDate') as HTMLInputElement).value,
    type: (form.elements.namedItem('type') as HTMLSelectElement).value as DeadlineType,
    recurrence: (form.elements.namedItem('recurrence') as HTMLSelectElement).value as DeadlineRecurrence,
    url: trimOrNull((form.elements.namedItem('url') as HTMLInputElement).value),
    notes: trimOrNull((form.elements.namedItem('notes') as HTMLTextAreaElement).value),
  };

  try {
    const url = editingId ? `/api/deadlines/${encodeURIComponent(editingId)}` : '/api/deadlines';
    const method = editingId ? 'PUT' : 'POST';
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = (await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))) as { error?: string };
      throw new Error(err.error ?? 'Save failed');
    }
    closeModal();
    await loadDeadlines();
  } catch (err) {
    console.error('[Deadlines] save error:', err);
    alert(err instanceof Error ? err.message : 'Save failed');
  }
}

async function handleComplete(id: string): Promise<void> {
  try {
    const resp = await fetch(`/api/deadlines/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!resp.ok) throw new Error('Complete failed');
    await loadDeadlines();
  } catch (err) {
    console.error('[Deadlines] complete error:', err);
  }
}

async function handleReopen(id: string): Promise<void> {
  try {
    const resp = await fetch(`/api/deadlines/${encodeURIComponent(id)}/complete`, {
      method: 'DELETE',
    });
    if (!resp.ok) throw new Error('Reopen failed');
    await loadDeadlines();
  } catch (err) {
    console.error('[Deadlines] reopen error:', err);
  }
}

async function handleDelete(id: string): Promise<void> {
  if (!confirm('Delete this deadline?')) return;
  try {
    const resp = await fetch(`/api/deadlines/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error('Delete failed');
    await loadDeadlines();
  } catch (err) {
    console.error('[Deadlines] delete error:', err);
  }
}

function goToObligationsTab(): void {
  const tab = document.querySelector<HTMLElement>('[data-tab="obligations"]');
  if (tab) tab.click();
}

async function handleSubscribe(): Promise<void> {
  const url = `${window.location.origin}/api/deadlines.ics`;
  try {
    await navigator.clipboard.writeText(url);
    alert(
      `ICS URL copied to clipboard:\n\n${url}\n\nIn Google Calendar: Other calendars → + → From URL.\nIn Apple Calendar: File → New Calendar Subscription.`,
    );
  } catch {
    window.prompt('Copy this ICS URL and add it as a subscribed calendar:', url);
  }
}

export function initDeadlines(): void {
  const addBtn = document.getElementById('deadlines-add-btn');
  if (addBtn) addBtn.addEventListener('click', openCreateModal);

  const closeBtn = document.getElementById('deadlines-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  const cancelBtn = document.getElementById('deadlines-modal-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  const form = document.getElementById('deadlines-form');
  if (form) form.addEventListener('submit', handleFormSubmit);

  const showCompletedCheckbox = document.getElementById('deadlines-show-completed') as HTMLInputElement | null;
  if (showCompletedCheckbox) {
    showCompletedCheckbox.addEventListener('change', () => {
      showCompleted = showCompletedCheckbox.checked;
      renderList(cachedFeed);
      if (currentView === 'calendar') renderCalendar(cachedFeed);
    });
  }

  document.querySelectorAll<HTMLElement>('[data-deadlines-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.deadlinesView as DeadlinesView;
      setView(view);
    });
  });

  const subscribeBtn = document.getElementById('deadlines-subscribe-btn');
  if (subscribeBtn) subscribeBtn.addEventListener('click', () => void handleSubscribe());

  const listEl = document.getElementById('deadlines-list');
  if (listEl) {
    listEl.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-deadline-action]');
      if (!btn) return;
      const action = btn.dataset.deadlineAction;
      const id = btn.dataset.id ?? '';
      if (action === 'complete') void handleComplete(id);
      else if (action === 'reopen') void handleReopen(id);
      else if (action === 'delete') void handleDelete(id);
      else if (action === 'edit') {
        const deadline = cachedDeadlines.get(id);
        if (deadline) openEditModal(deadline);
      } else if (action === 'go-to-obligation') goToObligationsTab();
    });
  }
}

/**
 * Leave calendar — FullCalendar month view on the Contracts tab.
 *
 * Shows working days, leave (holiday / sick), and public holidays at
 * a glance. Click a weekday cell to toggle leave on/off for all
 * selected contracts. Public holidays render as greyed background
 * events and are not clickable.
 *
 * Data sources:
 *   - `GET /api/contracts/:id/leave` for leave rows
 *   - `GET /api/public-holidays?entityId=…&start=…&end=…` for background events
 *   - Contract + accrual data already loaded by the Contracts module
 */

import { Calendar } from '@fullcalendar/core';
import type { EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { DateClickArg } from '@fullcalendar/interaction';

import { isContractCurrent } from '../../../shared/contract-display.js';
import type {
  Contract,
  LeaveRow,
  PublicHolidaysResponse,
} from '../../../shared/api-contracts.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';

const CALENDAR_PANEL_ID = 'contracts-leave-calendar-panel';
const CALENDAR_EL_ID = 'contracts-leave-calendar';
const TOGGLE_BTN_ID = 'contracts-leave-calendar-toggle';

let calendar: Calendar | null = null;
let leaveRows: LeaveRow[] = [];
let publicHolidayEvents: EventInput[] = [];
let activeContracts: Contract[] = [];
let onLeaveChanged: (() => Promise<void>) | null = null;

function getEl(id: string): HTMLElement | null {
  return document.getElementById(id);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchLeaveForContracts(contracts: Contract[]): Promise<LeaveRow[]> {
  const all: LeaveRow[] = [];
  for (const c of contracts) {
    const data = await fetchJson<{ leave: LeaveRow[] }>(`/api/contracts/${c.id}/leave`);
    all.push(...data.leave);
  }
  return all;
}

async function fetchPublicHolidays(
  entityIds: readonly string[],
  start: string,
  end: string,
): Promise<EventInput[]> {
  const seen = new Set<string>();
  const events: EventInput[] = [];
  const uniqueEntities = [...new Set(entityIds)];
  for (const entityId of uniqueEntities) {
    const data = await fetchJson<PublicHolidaysResponse>(
      `/api/public-holidays?entityId=${entityId}&start=${start}&end=${end}`,
    );
    for (const h of data.holidays) {
      if (seen.has(h.date)) continue;
      seen.add(h.date);
      events.push({
        title: h.name,
        start: h.date,
        allDay: true,
        display: 'background',
        classNames: ['leave-cal-public-holiday'],
      });
    }
  }
  return events;
}

function leaveToEvents(rows: LeaveRow[]): EventInput[] {
  return rows.map(row => ({
    id: row.id,
    title: row.type === 'sick' ? 'Sick' : 'Holiday',
    start: row.date,
    allDay: true,
    classNames: [row.type === 'sick' ? 'leave-cal-sick' : 'leave-cal-holiday'],
    extendedProps: { leaveId: row.id, contractId: row.contract_id },
  }));
}

function isWeekday(iso: string): boolean {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay();
  return d >= 1 && d <= 5;
}

function isPublicHoliday(iso: string): boolean {
  return publicHolidayEvents.some(e => e.start === iso);
}

async function toggleLeave(dateStr: string): Promise<void> {
  if (!isWeekday(dateStr) || isPublicHoliday(dateStr)) return;

  const existing = leaveRows.filter(r => r.date === dateStr);
  if (existing.length > 0) {
    for (const row of existing) {
      await fetch(`/api/contracts/${row.contract_id}/leave/${row.id}`, {
        method: 'DELETE',
      });
    }
  } else {
    for (const c of activeContracts) {
      await fetch(`/api/contracts/${c.id}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dates: [dateStr],
          type: 'holiday',
        }),
      });
    }
  }

  await refreshCalendarData();
  if (onLeaveChanged) await onLeaveChanged();
}

async function refreshCalendarData(): Promise<void> {
  if (!calendar) return;
  leaveRows = await fetchLeaveForContracts(activeContracts);
  calendar.removeAllEvents();
  calendar.addEventSource(publicHolidayEvents);
  calendar.addEventSource(leaveToEvents(leaveRows));
}

async function loadPublicHolidays(start: string, end: string): Promise<void> {
  const entityIds = activeContracts.map(c => c.issuing_entity_id);
  publicHolidayEvents = await fetchPublicHolidays(entityIds, start, end);
}

function ensureCalendar(): Calendar {
  if (calendar) return calendar;
  const el = getEl(CALENDAR_EL_ID);
  if (!el) throw new Error('Leave calendar element not found');

  calendar = new Calendar(el, {
    plugins: [dayGridPlugin, interactionPlugin],
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: '',
    },
    buttonText: { today: 'Today' },
    height: 'auto',
    fixedWeekCount: false,
    dateClick: (info: DateClickArg) => {
      void toggleLeave(info.dateStr);
    },
    datesSet: async (dateInfo) => {
      const start = dateInfo.startStr.slice(0, 10);
      const end = dateInfo.endStr.slice(0, 10);
      await loadPublicHolidays(start, end);
      await refreshCalendarData();
    },
  });

  return calendar;
}

export async function showLeaveCalendar(
  contracts: Contract[],
  leaveChangedCallback: () => Promise<void>,
): Promise<void> {
  activeContracts = contracts.filter(c => isContractCurrent(c, todayIsoLocal()));
  onLeaveChanged = leaveChangedCallback;

  const panel = getEl(CALENDAR_PANEL_ID);
  if (!panel) return;
  panel.hidden = false;

  const cal = ensureCalendar();
  cal.render();
  await refreshCalendarData();
}

export function hideLeaveCalendar(): void {
  const panel = getEl(CALENDAR_PANEL_ID);
  if (panel) panel.hidden = true;
}

export function initLeaveCalendar(
  contracts: Contract[],
  leaveChangedCallback: () => Promise<void>,
): void {
  const btn = getEl(TOGGLE_BTN_ID);
  if (!btn) return;

  let visible = false;
  btn.addEventListener('click', () => {
    visible = !visible;
    btn.textContent = visible ? 'Hide calendar' : 'Leave calendar';
    if (visible) {
      void showLeaveCalendar(contracts, leaveChangedCallback);
    } else {
      hideLeaveCalendar();
    }
  });
}

export function updateLeaveCalendarContracts(contracts: Contract[]): void {
  activeContracts = contracts.filter(c => isContractCurrent(c, todayIsoLocal()));
}

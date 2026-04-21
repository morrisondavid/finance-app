/**
 * ICS (RFC 5545) builder for the deadlines feed.
 *
 * Hand-rolled rather than pulled from an npm package: RFC 5545's
 * "VEVENT with VALUE=DATE" shape is ~30 lines and we want full control
 * over escaping, line folding, and UID stability (calendars
 * de-duplicate by UID, so drift == duplicate events for the user).
 *
 * We emit all-day events only — every deadline in the app is a
 * calendar-day reminder with no time-of-day. `DTSTART;VALUE=DATE` +
 * `DTEND;VALUE=DATE` where DTEND is exclusive (next day).
 *
 * UIDs are globally stable. Changing an item's content bumps
 * `SEQUENCE` via its ISO `updatedAt` timestamp so subscribed calendars
 * see the edit instead of ignoring it.
 */

import type { DeadlineFeedItem } from '../../shared/api-contracts.js';
import { shiftIsoDate } from '../../shared/iso-date.js';

export interface BuildIcsCalendarOptions {
  /** Calendar name shown in Google Calendar / Apple Calendar. */
  calendarName: string;
  /** RFC 5545 PRODID — tells calendar apps who generated the feed. */
  prodId?: string;
  /**
   * UID suffix (domain-style). Ensures the same item id doesn't collide
   * with feeds published by a different instance of the app.
   */
  uidDomain?: string;
  /** Current instant, injected so tests can pin DTSTAMP. */
  now?: Date;
}

const DEFAULT_PROD_ID = '-//Bank Statements App//Deadlines//EN';
const DEFAULT_UID_DOMAIN = 'bank-statements-app.local';

/**
 * Escape a single text value per RFC 5545 §3.3.11. Backslash first, then
 * semicolon, comma, newline — order matters (the backslash sub has to
 * run first or it'll double-escape its own insertions).
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 §3.1 line folding: fold at 75 octets. We approximate with
 * code units which is safe for the ASCII-only content we emit.
 */
export function foldIcsLine(line: string): string {
  const MAX = 75;
  if (line.length <= MAX) return line;
  const parts: string[] = [line.slice(0, MAX)];
  let i = MAX;
  const CONT = MAX - 1;
  while (i < line.length) {
    parts.push(` ${line.slice(i, i + CONT)}`);
    i += CONT;
  }
  return parts.join('\r\n');
}

function formatIsoDateForIcs(iso: string): string {
  return iso.replace(/-/g, '');
}

function formatTimestampForIcs(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Derive an integer SEQUENCE from `updatedAt`. Calendars use SEQUENCE
 * to decide whether a VEVENT update overrides a previously-cached one
 * with the same UID, so it *must* increase monotonically when the item
 * changes. We use the ISO timestamp's epoch-seconds, which gives us ~1s
 * resolution and is guaranteed monotonic within a single install.
 */
function deriveSequence(updatedAtIso: string): number {
  const t = Date.parse(updatedAtIso);
  if (Number.isNaN(t)) return 0;
  return Math.floor(t / 1000);
}

function buildDescription(item: DeadlineFeedItem): string {
  const parts: string[] = [];
  if (item.amount !== null) {
    parts.push(`Amount: £${item.amount.toFixed(2)}`);
  }
  if (item.entity) parts.push(`Entity: ${item.entity}`);
  parts.push(`Source: ${item.source}`);
  parts.push(`Type: ${item.type}`);
  if (item.notes) parts.push('', item.notes);
  return parts.join('\n');
}

/**
 * Build a full iCalendar document from a list of feed items. Returns a
 * single string with CRLF line endings as required by RFC 5545.
 */
export function buildIcsCalendar(
  items: readonly DeadlineFeedItem[],
  options: BuildIcsCalendarOptions,
): string {
  const prodId = options.prodId ?? DEFAULT_PROD_ID;
  const uidDomain = options.uidDomain ?? DEFAULT_UID_DOMAIN;
  const now = options.now ?? new Date();
  const dtstamp = formatTimestampForIcs(now);

  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push(`PRODID:${prodId}`);
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push(foldIcsLine(`X-WR-CALNAME:${escapeIcsText(options.calendarName)}`));

  for (const item of items) {
    const dtstart = formatIsoDateForIcs(item.dueDate);
    const dtend = formatIsoDateForIcs(shiftIsoDate(item.dueDate, 1));
    const uid = `${item.id}@${uidDomain}`;
    const summary = item.completed ? `✓ ${item.title}` : item.title;
    const description = buildDescription(item);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${dtstart}`);
    lines.push(`DTEND;VALUE=DATE:${dtend}`);
    lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(summary)}`));
    lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(description)}`));
    lines.push(`SEQUENCE:${deriveSequence(item.updatedAt)}`);
    lines.push(`STATUS:${item.completed ? 'COMPLETED' : 'CONFIRMED'}`);
    lines.push(`TRANSP:TRANSPARENT`);
    if (item.url) {
      lines.push(foldIcsLine(`URL:${item.url}`));
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return `${lines.join('\r\n')}\r\n`;
}

import { describe, it, expect } from 'vitest';
import {
  buildIcsCalendar,
  escapeIcsText,
  foldIcsLine,
} from './ics-builder.js';
import type { DeadlineFeedItem } from '../../shared/api-contracts.js';

/**
 * Regression-lock the ICS builder. Google Calendar + Apple Calendar
 * subscribe on content hash and SEQUENCE — any silent change to our
 * output will break subscribers, de-duplicate incorrectly, or orphan
 * events forever. We test: structure, escaping, folding, DTEND
 * exclusivity, SEQUENCE derivation, and UID stability.
 */

const FIXED_NOW = new Date('2026-04-21T10:00:00Z');

function buildItem(overrides: Partial<DeadlineFeedItem> = {}): DeadlineFeedItem {
  return {
    id: 'deadline:x',
    source: 'deadline',
    title: 'Test event',
    dueDate: '2026-06-15',
    type: 'other',
    status: 'upcoming',
    amount: null,
    entity: null,
    notes: null,
    url: null,
    updatedAt: '2026-04-21T00:00:00.000Z',
    completed: false,
    ...overrides,
  };
}

describe('escapeIcsText', () => {
  it('escapes backslashes first so the later substitutions do not double-escape', () => {
    expect(escapeIcsText('\\')).toBe('\\\\');
  });

  it('escapes commas, semicolons, and newlines', () => {
    expect(escapeIcsText('a, b; c\nd')).toBe('a\\, b\\; c\\nd');
  });

  it('handles CRLF the same as LF', () => {
    expect(escapeIcsText('a\r\nb')).toBe('a\\nb');
  });
});

describe('foldIcsLine', () => {
  it('returns short lines unchanged', () => {
    expect(foldIcsLine('hello')).toBe('hello');
  });

  it('folds at 75 octets with a leading space on continuation lines', () => {
    const line = 'A'.repeat(200);
    const folded = foldIcsLine(line);
    const parts = folded.split('\r\n');
    expect(parts[0].length).toBe(75);
    for (const cont of parts.slice(1)) {
      expect(cont.startsWith(' ')).toBe(true);
      expect(cont.length).toBeLessThanOrEqual(75);
    }
    const rejoined = parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('');
    expect(rejoined).toBe(line);
  });
});

describe('buildIcsCalendar', () => {
  it('emits a well-formed VCALENDAR wrapper', () => {
    const ics = buildIcsCalendar([], { calendarName: 'Test', now: FIXED_NOW });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('CALSCALE:GREGORIAN');
    expect(ics).toContain('X-WR-CALNAME:Test');
  });

  it('emits DTSTART/DTEND as all-day with DTEND exclusive (next day)', () => {
    const ics = buildIcsCalendar([buildItem({ dueDate: '2026-06-15' })], {
      calendarName: 'Test',
      now: FIXED_NOW,
    });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260615');
    expect(ics).toContain('DTEND;VALUE=DATE:20260616');
  });

  it('rolls DTEND to the next month correctly', () => {
    const ics = buildIcsCalendar([buildItem({ dueDate: '2026-06-30' })], {
      calendarName: 'Test',
      now: FIXED_NOW,
    });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260630');
    expect(ics).toContain('DTEND;VALUE=DATE:20260701');
  });

  it('UID is stable across rebuilds for the same feed id', () => {
    const a = buildIcsCalendar([buildItem()], { calendarName: 'Test', now: FIXED_NOW });
    const b = buildIcsCalendar([buildItem()], { calendarName: 'Test', now: FIXED_NOW });
    const uidA = /UID:(.+)/.exec(a)?.[1];
    const uidB = /UID:(.+)/.exec(b)?.[1];
    expect(uidA).toBeDefined();
    expect(uidA).toBe(uidB);
  });

  it('SEQUENCE grows monotonically with updatedAt', () => {
    const early = buildIcsCalendar(
      [buildItem({ updatedAt: '2026-04-01T00:00:00.000Z' })],
      { calendarName: 'Test', now: FIXED_NOW },
    );
    const late = buildIcsCalendar(
      [buildItem({ updatedAt: '2026-04-21T00:00:00.000Z' })],
      { calendarName: 'Test', now: FIXED_NOW },
    );
    const seqEarly = Number(/SEQUENCE:(\d+)/.exec(early)?.[1]);
    const seqLate = Number(/SEQUENCE:(\d+)/.exec(late)?.[1]);
    expect(seqLate).toBeGreaterThan(seqEarly);
  });

  it('STATUS reflects completion', () => {
    const open = buildIcsCalendar([buildItem({ completed: false })], {
      calendarName: 'Test',
      now: FIXED_NOW,
    });
    const done = buildIcsCalendar([buildItem({ completed: true })], {
      calendarName: 'Test',
      now: FIXED_NOW,
    });
    expect(open).toContain('STATUS:CONFIRMED');
    expect(done).toContain('STATUS:COMPLETED');
  });

  it('prefixes completed summaries with a check mark', () => {
    const ics = buildIcsCalendar([buildItem({ title: 'Renew MOT', completed: true })], {
      calendarName: 'Test',
      now: FIXED_NOW,
    });
    expect(ics).toContain('SUMMARY:✓ Renew MOT');
  });

  it('includes URL line only when present', () => {
    const withUrl = buildIcsCalendar([buildItem({ url: 'https://example.com' })], {
      calendarName: 'Test',
      now: FIXED_NOW,
    });
    const without = buildIcsCalendar([buildItem({ url: null })], {
      calendarName: 'Test',
      now: FIXED_NOW,
    });
    expect(withUrl).toContain('URL:https://example.com');
    expect(without).not.toContain('URL:');
  });

  it('escapes commas/semicolons in title/description', () => {
    const ics = buildIcsCalendar([buildItem({ title: 'A, B; C', notes: 'note, comma' })], {
      calendarName: 'Test',
      now: FIXED_NOW,
    });
    expect(ics).toContain('SUMMARY:A\\, B\\; C');
    expect(ics).toContain('note\\, comma');
  });

  it('uses CRLF line endings exclusively', () => {
    const ics = buildIcsCalendar([buildItem()], { calendarName: 'Test', now: FIXED_NOW });
    const bareNewlines = (ics.match(/(?<!\r)\n/g) ?? []).length;
    expect(bareNewlines).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { buildDeadlineFeed } from './deadline-feed.js';
import type { Deadline, ObligationRow } from '../../../shared/api-contracts.js';

/**
 * Regression-lock the unified feed. The list view, the calendar pill
 * colour, and the subscribed Google Calendar event all share this
 * builder — so every status/bucket boundary and every source-tag change
 * is a user-visible behaviour change that tests must catch.
 */
const TODAY = new Date('2026-06-10T12:00:00Z');

function buildDeadline(overrides: Partial<Deadline> = {}): Deadline {
  return {
    id: 'dl-1',
    type: 'other',
    title: 'Test deadline',
    dueDate: '2026-06-15',
    recurrence: 'one-off',
    notes: null,
    url: null,
    completedDate: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildObligationRow(overrides: Partial<ObligationRow> = {}): ObligationRow {
  return {
    id: 'ob-1',
    source: 'manual',
    type: 'vat',
    name: 'VAT Q1',
    entity: 'Test Ltd',
    frequency: 'quarterly',
    expectedAmount: 1000,
    dueDate: '2026-06-30',
    status: 'unpaid',
    paidAmount: null,
    paidDate: null,
    paidFromAccount: null,
    notes: null,
    personId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildDeadlineFeed', () => {
  it('merges deadlines + obligations into one sorted list', () => {
    const items = buildDeadlineFeed({
      today: TODAY,
      loaders: {
        loadDeadlines: () => [
          buildDeadline({ id: 'dl-a', dueDate: '2026-06-12' }),
          buildDeadline({ id: 'dl-b', dueDate: '2026-06-20' }),
        ],
        loadObligationRows: () => [
          buildObligationRow({ id: 'ob-a', dueDate: '2026-06-15' }),
          buildObligationRow({ id: 'ob-b', dueDate: '2026-06-05' }),
        ],
      },
    });

    expect(items.map(i => i.id)).toEqual([
      'obligation:ob-b',
      'deadline:dl-a',
      'obligation:ob-a',
      'deadline:dl-b',
    ]);
  });

  it('prefixes feed ids so deadline vs obligation can never collide', () => {
    const items = buildDeadlineFeed({
      today: TODAY,
      loaders: {
        loadDeadlines: () => [buildDeadline({ id: 'shared' })],
        loadObligationRows: () => [buildObligationRow({ id: 'shared' })],
      },
    });
    expect(items.map(i => i.id).sort()).toEqual(['deadline:shared', 'obligation:shared']);
  });

  it('skips obligations without a due date', () => {
    const items = buildDeadlineFeed({
      today: TODAY,
      loaders: {
        loadDeadlines: () => [],
        loadObligationRows: () => [buildObligationRow({ id: 'ob', dueDate: null })],
      },
    });
    expect(items).toEqual([]);
  });

  it('derives status from due date + completion flag', () => {
    const items = buildDeadlineFeed({
      today: TODAY,
      loaders: {
        loadDeadlines: () => [
          buildDeadline({ id: 'overdue', dueDate: '2026-06-01' }),
          buildDeadline({ id: 'soon', dueDate: '2026-06-13' }),
          buildDeadline({ id: 'later', dueDate: '2026-08-01' }),
          buildDeadline({ id: 'done', dueDate: '2026-06-01', completedDate: '2026-05-30' }),
        ],
        loadObligationRows: () => [],
      },
    });
    const byId = Object.fromEntries(items.map(i => [i.id, i.status]));
    expect(byId['deadline:overdue']).toBe('overdue');
    expect(byId['deadline:soon']).toBe('due-soon');
    expect(byId['deadline:later']).toBe('upcoming');
    expect(byId['deadline:done']).toBe('completed');
  });

  it('marks obligations with paid/confirmed status as completed', () => {
    const items = buildDeadlineFeed({
      today: TODAY,
      loaders: {
        loadDeadlines: () => [],
        loadObligationRows: () => [
          buildObligationRow({ id: 'paid', status: 'paid' }),
          buildObligationRow({ id: 'confirmed', status: 'confirmed' }),
          buildObligationRow({ id: 'unpaid', status: 'unpaid' }),
        ],
      },
    });
    const byId = Object.fromEntries(items.map(i => [i.id, i.completed]));
    expect(byId['obligation:paid']).toBe(true);
    expect(byId['obligation:confirmed']).toBe(true);
    expect(byId['obligation:unpaid']).toBe(false);
  });

  it('applies from/to window inclusively on both ends', () => {
    const items = buildDeadlineFeed({
      today: TODAY,
      from: '2026-06-01',
      to: '2026-06-30',
      loaders: {
        loadDeadlines: () => [
          buildDeadline({ id: 'before', dueDate: '2026-05-31' }),
          buildDeadline({ id: 'start', dueDate: '2026-06-01' }),
          buildDeadline({ id: 'end', dueDate: '2026-06-30' }),
          buildDeadline({ id: 'after', dueDate: '2026-07-01' }),
        ],
        loadObligationRows: () => [],
      },
    });
    expect(items.map(i => i.id)).toEqual(['deadline:start', 'deadline:end']);
  });

  it('excludeCompleted drops done items from both sources', () => {
    const items = buildDeadlineFeed({
      today: TODAY,
      excludeCompleted: true,
      loaders: {
        loadDeadlines: () => [
          buildDeadline({ id: 'open', completedDate: null }),
          buildDeadline({ id: 'done', completedDate: '2026-06-01' }),
        ],
        loadObligationRows: () => [
          buildObligationRow({ id: 'paid', status: 'paid' }),
          buildObligationRow({ id: 'unpaid', status: 'unpaid' }),
        ],
      },
    });
    expect(items.map(i => i.id).sort()).toEqual(['deadline:open', 'obligation:unpaid']);
  });

  it('carries notes + url through to feed output', () => {
    const [item] = buildDeadlineFeed({
      today: TODAY,
      loaders: {
        loadDeadlines: () => [
          buildDeadline({ notes: 'remember', url: 'https://example.com' }),
        ],
        loadObligationRows: () => [],
      },
    });
    expect(item.notes).toBe('remember');
    expect(item.url).toBe('https://example.com');
    expect(item.amount).toBeNull();
  });

  it('carries obligation amount + entity + null url through to feed output', () => {
    const [item] = buildDeadlineFeed({
      today: TODAY,
      loaders: {
        loadDeadlines: () => [],
        loadObligationRows: () => [buildObligationRow({ expectedAmount: 1234.56, entity: 'Acme Ltd' })],
      },
    });
    expect(item.amount).toBe(1234.56);
    expect(item.entity).toBe('Acme Ltd');
    expect(item.url).toBeNull();
  });
});

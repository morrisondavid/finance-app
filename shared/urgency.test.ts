import { describe, it, expect } from 'vitest';
import {
  deriveUrgencyStatus,
  urgencyBucket,
  bucketItemsByUrgency,
  DUE_SOON_WINDOW_DAYS,
} from './urgency.js';

const TODAY = new Date(2026, 3, 21);
const TODAY_ISO = '2026-04-21';

describe('deriveUrgencyStatus', () => {
  it.each([
    // dueDate, completed, expected
    ['2026-04-20', false, 'overdue'],
    ['2026-04-21', false, 'due-soon'],
    ['2026-04-28', false, 'due-soon'],
    ['2026-04-29', false, 'upcoming'],
    ['2026-05-30', false, 'upcoming'],
    ['2027-04-21', false, 'upcoming'],

    ['2026-04-20', true, 'completed'],
    ['2026-04-21', true, 'completed'],
    ['2026-05-01', true, 'completed'],
    ['2027-04-21', true, 'completed'],
  ] as const)('dueDate=%s completed=%s → %s', (dueDate, completed, expected) => {
    expect(deriveUrgencyStatus(dueDate, TODAY, completed)).toBe(expected);
  });

  it(`"due-soon" window is exactly ${DUE_SOON_WINDOW_DAYS} days inclusive`, () => {
    expect(deriveUrgencyStatus('2026-04-28', TODAY, false)).toBe('due-soon');
    expect(deriveUrgencyStatus('2026-04-29', TODAY, false)).toBe('upcoming');
  });

  it('treats today as due-soon (not overdue, not upcoming)', () => {
    expect(deriveUrgencyStatus(TODAY_ISO, TODAY, false)).toBe('due-soon');
  });
});

describe('urgencyBucket', () => {
  it.each([
    ['2026-04-20', false, 'overdue'],
    ['2026-04-21', false, 'this-week'],
    ['2026-04-28', false, 'this-week'],
    ['2026-04-29', false, 'this-month'],
    ['2026-04-30', false, 'this-month'],
    ['2026-05-01', false, 'this-year'],
    ['2026-12-31', false, 'this-year'],
    ['2027-01-01', false, 'later'],
    ['2030-06-15', false, 'later'],

    ['2026-04-20', true, 'completed'],
    ['2026-04-29', true, 'completed'],
    ['2030-06-15', true, 'completed'],
  ] as const)('dueDate=%s completed=%s → %s', (dueDate, completed, expected) => {
    expect(urgencyBucket(dueDate, TODAY, completed)).toBe(expected);
  });

  it('boundary: last day of current month is this-month when outside due-soon window', () => {
    expect(urgencyBucket('2026-04-30', TODAY, false)).toBe('this-month');
  });

  it('boundary: first day of next month falls into this-year', () => {
    expect(urgencyBucket('2026-05-01', TODAY, false)).toBe('this-year');
  });

  it('boundary: last day of current year is this-year', () => {
    expect(urgencyBucket('2026-12-31', TODAY, false)).toBe('this-year');
  });

  it('boundary: first day of next year is later', () => {
    expect(urgencyBucket('2027-01-01', TODAY, false)).toBe('later');
  });
});

describe('bucketItemsByUrgency', () => {
  it('returns every bucket key even when empty', () => {
    const groups = bucketItemsByUrgency([], TODAY);
    expect(Object.keys(groups).sort()).toEqual([
      'completed',
      'later',
      'overdue',
      'this-month',
      'this-week',
      'this-year',
    ]);
    for (const arr of Object.values(groups)) expect(arr).toEqual([]);
  });

  it('routes each item to the correct bucket', () => {
    const items = [
      { id: 'a', dueDate: '2026-04-15', completed: false }, // overdue
      { id: 'b', dueDate: '2026-04-25', completed: false }, // this-week
      { id: 'c', dueDate: '2026-04-30', completed: false }, // this-month
      { id: 'd', dueDate: '2026-09-01', completed: false }, // this-year
      { id: 'e', dueDate: '2028-01-01', completed: false }, // later
      { id: 'f', dueDate: '2026-04-15', completed: true },  // completed
    ];
    const groups = bucketItemsByUrgency(items, TODAY);
    expect(groups.overdue.map(i => i.id)).toEqual(['a']);
    expect(groups['this-week'].map(i => i.id)).toEqual(['b']);
    expect(groups['this-month'].map(i => i.id)).toEqual(['c']);
    expect(groups['this-year'].map(i => i.id)).toEqual(['d']);
    expect(groups.later.map(i => i.id)).toEqual(['e']);
    expect(groups.completed.map(i => i.id)).toEqual(['f']);
  });

  it('preserves input order within each bucket', () => {
    const items = [
      { id: 'x', dueDate: '2026-04-22', completed: false },
      { id: 'y', dueDate: '2026-04-21', completed: false },
      { id: 'z', dueDate: '2026-04-23', completed: false },
    ];
    const groups = bucketItemsByUrgency(items, TODAY);
    expect(groups['this-week'].map(i => i.id)).toEqual(['x', 'y', 'z']);
  });
});

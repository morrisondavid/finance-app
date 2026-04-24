/**
 * Lock the extracted `calculateWorkload` helper. Two consumers (income
 * accrual today, invoice drafts in §1.3 Phase 2) depend on this math
 * being stable and identical across both paths — a subtle bug here
 * would silently change both accrual banners AND invoice line totals.
 *
 * The fixture contracts mirror the accrual test suite: `dc-sow-2026`
 * is Mon–Fri @ £550, `lf-2026-mar` is Mon–Fri @ £500.
 */

import { describe, it, expect } from 'vitest';
import { calculateWorkload, leaveDatesIn } from './workload.js';
import { parseContractRow } from './csv-io.js';
import { dcSowRow, lfContractRow } from './test-helpers.js';
import { parseLeaveRow, composeLeaveId } from '../leave/csv-io.js';
import type { LeaveRow } from '../../../shared/api-contracts.js';

function mkLeave(contractId: string, date: string): LeaveRow {
  return parseLeaveRow({
    id: composeLeaveId(contractId, date),
    contract_id: contractId,
    date,
    type: 'holiday',
    notes: '',
    external_logged: 'false',
    created_at: date,
    updated_at: date,
  });
}

const dc = parseContractRow(dcSowRow);
const lf = parseContractRow(lfContractRow);

describe('calculateWorkload', () => {
  it('returns all-zero on a degenerate (start > end) window', () => {
    const res = calculateWorkload({
      contract: dc,
      leaveRows: [],
      start: '2026-04-30',
      end: '2026-04-01',
    });
    expect(res).toEqual({
      workingDays: 0,
      leaveDays: 0,
      subtotal: 0,
      dayRate: 550,
      currency: 'GBP',
    });
  });

  it('counts Mon–Fri across a full calendar month with no leave', () => {
    // April 2026 has 22 weekdays.
    const res = calculateWorkload({
      contract: dc,
      leaveRows: [],
      start: '2026-04-01',
      end: '2026-04-30',
    });
    expect(res.workingDays).toBe(22);
    expect(res.leaveDays).toBe(0);
    expect(res.subtotal).toBe(22 * 550);
  });

  it('excludes booked leave from workingDays and reports leaveDays', () => {
    const res = calculateWorkload({
      contract: dc,
      leaveRows: [
        mkLeave('dc-sow-2026', '2026-04-06'),
        mkLeave('dc-sow-2026', '2026-04-07'),
      ],
      start: '2026-04-01',
      end: '2026-04-30',
    });
    expect(res.workingDays).toBe(20);
    expect(res.leaveDays).toBe(2);
    expect(res.subtotal).toBe(20 * 550);
  });

  it('ignores leave rows for other contracts', () => {
    const res = calculateWorkload({
      contract: dc,
      leaveRows: [mkLeave('lf-2026-mar', '2026-04-06')],
      start: '2026-04-01',
      end: '2026-04-30',
    });
    expect(res.workingDays).toBe(22);
    expect(res.leaveDays).toBe(0);
  });

  it('ignores leave rows outside the window', () => {
    const res = calculateWorkload({
      contract: dc,
      leaveRows: [mkLeave('dc-sow-2026', '2026-03-31')],
      start: '2026-04-01',
      end: '2026-04-30',
    });
    expect(res.leaveDays).toBe(0);
  });

  it('weekend-only window returns zero working days', () => {
    // 2026-04-04 (Sat) → 2026-04-05 (Sun).
    const res = calculateWorkload({
      contract: dc,
      leaveRows: [],
      start: '2026-04-04',
      end: '2026-04-05',
    });
    expect(res.workingDays).toBe(0);
    expect(res.subtotal).toBe(0);
  });

  it('single-day weekday window counts as one working day', () => {
    // 2026-04-07 is a Tuesday.
    const res = calculateWorkload({
      contract: dc,
      leaveRows: [],
      start: '2026-04-07',
      end: '2026-04-07',
    });
    expect(res.workingDays).toBe(1);
    expect(res.subtotal).toBe(550);
  });

  it('passes through day_rate and invoice_currency verbatim', () => {
    const res = calculateWorkload({
      contract: lf,
      leaveRows: [],
      start: '2026-04-01',
      end: '2026-04-30',
    });
    expect(res.dayRate).toBe(500);
    expect(res.currency).toBe('GBP');
    expect(res.subtotal).toBe(22 * 500);
  });

  it('leaveDates that fall on weekends do not count toward workingDays (already excluded by mask)', () => {
    // Sat leave row is ignored by the mask anyway; the count of
    // leaveDays reflects booked leave in the window regardless of
    // whether it also fell on a non-working day.
    const res = calculateWorkload({
      contract: dc,
      leaveRows: [mkLeave('dc-sow-2026', '2026-04-04')],
      start: '2026-04-01',
      end: '2026-04-30',
    });
    expect(res.workingDays).toBe(22); // unchanged — Sat wasn't a working day
    expect(res.leaveDays).toBe(1);
  });
});

describe('leaveDatesIn', () => {
  it('returns an empty set when no rows match the contract', () => {
    expect(leaveDatesIn([mkLeave('other', '2026-04-01')], 'dc-sow-2026', '2026-04-01', '2026-04-30').size).toBe(0);
  });

  it('filters inclusively on both window edges', () => {
    const rows = [
      mkLeave('dc-sow-2026', '2026-04-01'),
      mkLeave('dc-sow-2026', '2026-04-30'),
      mkLeave('dc-sow-2026', '2026-05-01'),
    ];
    expect(leaveDatesIn(rows, 'dc-sow-2026', '2026-04-01', '2026-04-30').size).toBe(2);
  });
});

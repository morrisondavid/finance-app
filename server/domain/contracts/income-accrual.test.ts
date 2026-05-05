/**
 * Table-driven tests for `computeAccrual`.
 *
 * The fixture pair mirrors `test-helpers.ts`:
 *   - `dc-sow-2026`: monthly-cadence contract, Mon–Fri, £550/day.
 *   - `lf-2026-mar`: weekly-cadence contract, Mon–Fri, £500/day.
 *
 * There are now TWO reporting windows per result:
 *   - Owed window (Window A) — starts the day after the last matched
 *     invoice payment (or the first of the calendar month when no
 *     payment has been matched), clamped to `contract.start_date`,
 *     ending at `today` (clipped to `end_date`). Drives
 *     `worked_days_to_date`, `accrued_to_date`, and
 *     `leave_days_in_period`.
 *   - Projection window (Window B) — always the calendar month
 *     containing `today`, clipped to the contract. Drives
 *     `worked_days_remaining` and `projected_period_total`.
 *
 * Cases below cover both windows independently so regressions in
 * either axis surface cleanly.
 */

import { describe, it, expect } from 'vitest';
import { computeAccrual } from './income-accrual.js';
import { parseContractRow } from './csv-io.js';
import {
  dcSowRow,
  lfContractRow,
  lfFzcoContractRow,
  rowFromHeaders,
} from './test-helpers.js';
import { parseLeaveRow } from '../leave/csv-io.js';
import { composeLeaveId } from '../leave/csv-io.js';
import type { LeaveRow } from '../../../shared/api-contracts.js';

function mkLeave(contractId: string, date: string, type: 'holiday' | 'sick' = 'holiday'): LeaveRow {
  return parseLeaveRow({
    id: composeLeaveId(contractId, date),
    contract_id: contractId,
    date,
    type,
    notes: '',
    external_logged: 'false',
    created_at: date,
    updated_at: date,
  });
}

const dc = parseContractRow(dcSowRow);
const lf = parseContractRow(lfContractRow);
const lfFzco = parseContractRow(lfFzcoContractRow);

describe('computeAccrual — no matched payment (fallback to month-start)', () => {
  it('no leave, mid-month: counts elapsed Mon–Fri up to today from month-start', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [],
      today: '2026-04-15',
      lastPaymentDate: null,
    });
    expect(res.period_start).toBe('2026-04-01');
    expect(res.period_end).toBe('2026-04-30');
    expect(res.owed_window_start).toBe('2026-04-01');
    expect(res.owed_window_end).toBe('2026-04-15');
    expect(res.worked_days_to_date).toBe(11);
    expect(res.worked_days_remaining).toBe(11);
    expect(res.leave_days_in_period).toBe(0);
    expect(res.accrued_to_date).toBe(11 * 550);
    expect(res.projected_period_total).toBe(22 * 550);
  });

  it('leave in the past (same month): reduces worked_days_to_date and projected equally', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [mkLeave('dc-sow-2026', '2026-04-06')],
      today: '2026-04-15',
      lastPaymentDate: null,
    });
    expect(res.worked_days_to_date).toBe(10);
    expect(res.worked_days_remaining).toBe(11);
    expect(res.leave_days_in_period).toBe(1);
    expect(res.projected_period_total).toBe(21 * 550);
  });

  it('leave in the future of the same month: reduces remaining + projected only (owed window unaware)', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [mkLeave('dc-sow-2026', '2026-04-27')],
      today: '2026-04-15',
      lastPaymentDate: null,
    });
    expect(res.worked_days_to_date).toBe(11);
    expect(res.worked_days_remaining).toBe(10);
    // Leave only lives in projection window; owed window ends at today.
    expect(res.leave_days_in_period).toBe(0);
    expect(res.projected_period_total).toBe(21 * 550);
  });

  it('ignores leave on weekend (not in the mask → no double-count)', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [mkLeave('dc-sow-2026', '2026-04-11')],
      today: '2026-04-15',
      lastPaymentDate: null,
    });
    expect(res.worked_days_to_date).toBe(11);
    expect(res.worked_days_remaining).toBe(11);
    // Weekend date doesn't pass the mask in countWorkingDays, but it's
    // still counted in the raw leave set (the filter is by date range
    // only, not by mask, because a leave row for a Sunday is still a
    // row) — this test just confirms the counts aren't double-hit.
    expect(res.leave_days_in_period).toBe(1);
    expect(res.projected_period_total).toBe(22 * 550);
  });

  it('ignores leave from other contracts', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [mkLeave('lf-2026-mar', '2026-04-06')],
      today: '2026-04-15',
      lastPaymentDate: null,
    });
    expect(res.worked_days_to_date).toBe(11);
    expect(res.leave_days_in_period).toBe(0);
  });

  it('contract starts mid-period: both window starts clip to month start (contract already active)', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [],
      today: '2026-03-15',
      lastPaymentDate: null,
    });
    expect(res.period_start).toBe('2026-03-01');
    expect(res.period_end).toBe('2026-03-31');
    expect(res.owed_window_start).toBe('2026-03-01');
  });

  it('today before contract start: owed window is empty, everything zeroes', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [],
      today: '2025-12-15',
      lastPaymentDate: null,
    });
    expect(res.period_start).toBe('2025-12-01');
    expect(res.worked_days_to_date).toBe(0);
    // Projection still runs across the remaining contract days in December
    // (none — contract has not started).
    expect(res.worked_days_remaining).toBe(0);
  });
});

describe('computeAccrual — with a matched last payment', () => {
  it('rebases worked/accrued onto the day AFTER last payment', () => {
    // DC paid on 2026-04-05 (a Sunday, last working day is Friday
    // 2026-04-03). Today 2026-04-15. Owed window = [2026-04-06, 2026-04-15]
    // = Mon 6, Tue 7, Wed 8, Thu 9, Fri 10, Mon 13, Tue 14, Wed 15 = 8 days.
    const res = computeAccrual({
      contract: dc,
      leaveRows: [],
      today: '2026-04-15',
      lastPaymentDate: '2026-04-05',
    });
    expect(res.owed_window_start).toBe('2026-04-06');
    expect(res.owed_window_end).toBe('2026-04-15');
    expect(res.worked_days_to_date).toBe(8);
    expect(res.accrued_to_date).toBe(8 * 550);
    // Projection unchanged — still the full calendar month.
    expect(res.projected_period_total).toBe(22 * 550);
  });

  it('owed window CAN span multiple months when payment is old (FZCO-shaped case)', () => {
    // FZCO contract starts 2026-03-02, no payment anywhere in history.
    // Fallback is the first of the current calendar month (2026-04-01).
    // Today = 2026-04-15. Window = [2026-04-01, 2026-04-15] = 11 working days.
    const noPayment = computeAccrual({
      contract: lfFzco,
      leaveRows: [],
      today: '2026-04-15',
      lastPaymentDate: null,
    });
    expect(noPayment.owed_window_start).toBe('2026-04-01');
    expect(noPayment.worked_days_to_date).toBe(11);

    // Now pretend the last payment was 2026-02-20 (pre-start) — clamp to
    // contract start (2026-03-02). Window = [2026-03-02, 2026-04-15].
    // March: 2..31 working days. Using Mon-Fri mask across
    // 2026-03-02 (Mon) → 2026-03-31 (Tue) = 22 days.
    // April 1..15 = 11 days. Total 33.
    const oldPayment = computeAccrual({
      contract: lfFzco,
      leaveRows: [],
      today: '2026-04-15',
      lastPaymentDate: '2026-02-20',
    });
    expect(oldPayment.owed_window_start).toBe('2026-03-02');
    expect(oldPayment.worked_days_to_date).toBe(22 + 11);
    expect(oldPayment.accrued_to_date).toBe((22 + 11) * 500);
    // Projection still only measures the current calendar month.
    // FZCO contract.end_date = 2026-04-30, so the full calendar April
    // is inside it: 22 working days × £500 = £11,000.
    expect(oldPayment.projected_period_total).toBe(22 * 500);
  });

  it('payment is today itself: owed window starts tomorrow → zeroes (degenerate)', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [],
      today: '2026-04-15',
      lastPaymentDate: '2026-04-15',
    });
    expect(res.worked_days_to_date).toBe(0);
    expect(res.accrued_to_date).toBe(0);
    // Projection window unaffected.
    expect(res.projected_period_total).toBe(22 * 550);
  });

  it('leave inside the owed window reduces owed_days_to_date independently of projection', () => {
    // Paid on 2026-04-05; leave on 2026-04-08 (Wed, inside owed window).
    // Owed = 8 − 1 = 7 days. Projection = 22 − 1 = 21 days.
    const res = computeAccrual({
      contract: dc,
      leaveRows: [mkLeave('dc-sow-2026', '2026-04-08')],
      today: '2026-04-15',
      lastPaymentDate: '2026-04-05',
    });
    expect(res.worked_days_to_date).toBe(7);
    expect(res.leave_days_in_period).toBe(1);
    expect(res.projected_period_total).toBe(21 * 550);
  });

  it('leave outside the owed window but inside projection: projection drops, owed untouched', () => {
    // Paid on 2026-04-14; leave on 2026-04-27. Owed window starts 15th.
    // 27 is after today (we are at 15), so not in owed window at all.
    const res = computeAccrual({
      contract: dc,
      leaveRows: [mkLeave('dc-sow-2026', '2026-04-27')],
      today: '2026-04-15',
      lastPaymentDate: '2026-04-14',
    });
    expect(res.leave_days_in_period).toBe(0);
    expect(res.projected_period_total).toBe(21 * 550);
  });
});

describe('computeAccrual — weekly-cadence contract (lf-2026-mar) projection still calendar-month', () => {
  it('mid-month, no payment, no leave: owed from month-start, projection full March', () => {
    const res = computeAccrual({
      contract: lf,
      leaveRows: [],
      today: '2026-03-25',
      lastPaymentDate: null,
    });
    expect(res.period_start).toBe('2026-03-01');
    expect(res.period_end).toBe('2026-03-31');
    expect(res.worked_days_to_date).toBe(18);
    expect(res.worked_days_remaining).toBe(4);
    expect(res.projected_period_total).toBe(22 * 500);
  });

  it('booked future leave reduces remaining + projection (not owed)', () => {
    const res = computeAccrual({
      contract: lf,
      leaveRows: [mkLeave('lf-2026-mar', '2026-03-27')],
      today: '2026-03-25',
      lastPaymentDate: null,
    });
    expect(res.worked_days_to_date).toBe(18);
    expect(res.worked_days_remaining).toBe(3);
    expect(res.projected_period_total).toBe(21 * 500);
  });

  it('on contract end_date, no payment: owed covers month-start..end, no remaining', () => {
    const res = computeAccrual({
      contract: lf,
      leaveRows: [],
      today: '2026-03-31',
      lastPaymentDate: null,
    });
    expect(res.worked_days_to_date).toBe(22);
    expect(res.worked_days_remaining).toBe(0);
    expect(res.projected_period_total).toBe(22 * 500);
  });

  it('today past contract end_date: everything zero', () => {
    const res = computeAccrual({
      contract: lf,
      leaveRows: [],
      today: '2026-04-15',
      lastPaymentDate: null,
    });
    expect(res.worked_days_to_date).toBe(0);
    expect(res.worked_days_remaining).toBe(0);
    expect(res.accrued_to_date).toBe(0);
    expect(res.projected_period_total).toBe(0);
  });
});

describe('computeAccrual — passthrough fields', () => {
  it('returns contract_id, day_rate and currency unchanged', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [],
      today: '2026-04-15',
      lastPaymentDate: null,
    });
    expect(res.contract_id).toBe('dc-sow-2026');
    expect(res.day_rate).toBe(550);
    expect(res.currency).toBe('GBP');
  });

  it('lf day_rate is £500', () => {
    const res = computeAccrual({
      contract: lf,
      leaveRows: [],
      today: '2026-03-25',
      lastPaymentDate: null,
    });
    expect(res.day_rate).toBe(500);
  });

  it('contract with zero weekday mask: worked/remaining/projected are 0', () => {
    const zeroMaskRow = rowFromHeaders({
      ...lfContractRow,
      works_monday: 'false',
      works_tuesday: 'false',
      works_wednesday: 'false',
      works_thursday: 'false',
      works_friday: 'false',
      works_saturday: 'false',
      works_sunday: 'false',
    });
    const zeroMask = parseContractRow(zeroMaskRow);
    const res = computeAccrual({
      contract: zeroMask,
      leaveRows: [],
      today: '2026-03-25',
      lastPaymentDate: null,
    });
    expect(res.worked_days_to_date).toBe(0);
    expect(res.worked_days_remaining).toBe(0);
    expect(res.projected_period_total).toBe(0);
  });
});

describe('computeAccrual — total_contract_working_days / total_contract_value', () => {
  it('contract with end_date: computes total working days and value from start to end', () => {
    // dc-sow-2026 runs 2026-01-01 → 2026-04-30, Mon–Fri, £550/day.
    // Exact count depends on public holidays; assert band for a ~4-month engagement.
    const res = computeAccrual({
      contract: dc,
      leaveRows: [],
      today: '2026-04-01',
      lastPaymentDate: null,
    });
    expect(res.total_contract_working_days).not.toBeNull();
    expect(res.total_contract_working_days).toBeGreaterThanOrEqual(75);
    expect(res.total_contract_working_days).toBeLessThanOrEqual(95);
    expect(res.total_contract_value).not.toBeNull();
    // total_contract_value = total_contract_working_days × 550
    expect(res.total_contract_value).toBeCloseTo(
      (res.total_contract_working_days ?? 0) * 550,
      0,
    );
  });

  it('open-ended contract (no end_date): both fields are null', () => {
    // Manufacture an open-ended variant of dc by nulling end_date.
    const openEnded = { ...dc, end_date: null };
    const res = computeAccrual({
      contract: openEnded,
      leaveRows: [],
      today: '2026-04-01',
      lastPaymentDate: null,
    });
    expect(res.total_contract_working_days).toBeNull();
    expect(res.total_contract_value).toBeNull();
  });
});

/**
 * Table-driven tests for `computeAccrual`.
 *
 * The fixture pair mirrors `test-helpers.ts`:
 *   - `dc-sow-2026`: monthly-cadence contract, Mon–Fri, £550/day.
 *   - `lf-2026-mar`: weekly-cadence contract, Mon–Fri, £500/day.
 *
 * The reporting window is **always the calendar month** containing
 * `today`, regardless of cadence — the stats surface answers
 * "what will I receive this month?" consistently. Cases cover leave
 * positioned past / straddling / future, contract-window clipping
 * at both ends, days outside the weekday mask, and a currency
 * passthrough smoke test.
 */

import { describe, it, expect } from 'vitest';
import { computeAccrual } from './income-accrual.js';
import { parseContractRow } from './csv-io.js';
import {
  dcSowRow,
  lfContractRow,
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

describe('computeAccrual — monthly-cadence contract (dc-sow-2026)', () => {
  it('no leave, mid-month: counts elapsed Mon–Fri up to today', () => {
    const res = computeAccrual({ contract: dc, leaveRows: [], today: '2026-04-15' });
    expect(res.period_start).toBe('2026-04-01');
    expect(res.period_end).toBe('2026-04-30');
    expect(res.worked_days_to_date).toBe(11);
    expect(res.worked_days_remaining).toBe(11);
    expect(res.leave_days_in_period).toBe(0);
    expect(res.accrued_to_date).toBe(11 * 550);
    expect(res.projected_period_total).toBe(22 * 550);
  });

  it('leave entirely in the past (same period): reduces worked_days_to_date only', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [mkLeave('dc-sow-2026', '2026-04-06')],
      today: '2026-04-15',
    });
    expect(res.worked_days_to_date).toBe(10);
    expect(res.worked_days_remaining).toBe(11);
    expect(res.leave_days_in_period).toBe(1);
    expect(res.projected_period_total).toBe(21 * 550);
  });

  it('leave entirely in the future: reduces worked_days_remaining only', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [mkLeave('dc-sow-2026', '2026-04-27')],
      today: '2026-04-15',
    });
    expect(res.worked_days_to_date).toBe(11);
    expect(res.worked_days_remaining).toBe(10);
    expect(res.leave_days_in_period).toBe(1);
    expect(res.projected_period_total).toBe(21 * 550);
  });

  it('leave on today itself is not counted as worked: today excluded, tomorrow onwards unaffected', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [mkLeave('dc-sow-2026', '2026-04-15')],
      today: '2026-04-15',
    });
    expect(res.worked_days_to_date).toBe(10);
    expect(res.worked_days_remaining).toBe(11);
    expect(res.leave_days_in_period).toBe(1);
  });

  it('ignores leave on weekend (not in the mask → no double-count)', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [mkLeave('dc-sow-2026', '2026-04-11')],
      today: '2026-04-15',
    });
    expect(res.worked_days_to_date).toBe(11);
    expect(res.worked_days_remaining).toBe(11);
    expect(res.leave_days_in_period).toBe(1);
    expect(res.projected_period_total).toBe(22 * 550);
  });

  it('ignores leave from other contracts', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [mkLeave('lf-2026-mar', '2026-04-06')],
      today: '2026-04-15',
    });
    expect(res.worked_days_to_date).toBe(11);
    expect(res.leave_days_in_period).toBe(0);
  });

  it('ignores leave outside the billing period', () => {
    const res = computeAccrual({
      contract: dc,
      leaveRows: [mkLeave('dc-sow-2026', '2026-05-05')],
      today: '2026-04-15',
    });
    expect(res.leave_days_in_period).toBe(0);
  });

  it('contract starts mid-period: period_start clips to start_date', () => {
    const res = computeAccrual({ contract: dc, leaveRows: [], today: '2026-03-15' });
    expect(res.period_start).toBe('2026-03-02');
    expect(res.period_end).toBe('2026-03-31');
  });

  it('today before contract start: period_start clips, worked_to_date is 0', () => {
    const res = computeAccrual({ contract: dc, leaveRows: [], today: '2026-03-01' });
    expect(res.period_start).toBe('2026-03-02');
    expect(res.worked_days_to_date).toBe(0);
    expect(res.worked_days_remaining).toBeGreaterThan(0);
  });
});

describe('computeAccrual — weekly-cadence contract (lf-2026-mar) still reports on the calendar month', () => {
  it('mid-month, no leave: full March Mon–Fri window (22 working days)', () => {
    const res = computeAccrual({ contract: lf, leaveRows: [], today: '2026-03-25' });
    expect(res.period_start).toBe('2026-03-01');
    expect(res.period_end).toBe('2026-03-31');
    expect(res.worked_days_to_date).toBe(18);
    expect(res.worked_days_remaining).toBe(4);
    expect(res.leave_days_in_period).toBe(0);
    expect(res.projected_period_total).toBe(22 * 500);
  });

  it('booked future leave reduces remaining (not to-date)', () => {
    const res = computeAccrual({
      contract: lf,
      leaveRows: [mkLeave('lf-2026-mar', '2026-03-27')],
      today: '2026-03-25',
    });
    expect(res.worked_days_to_date).toBe(18);
    expect(res.worked_days_remaining).toBe(3);
    expect(res.leave_days_in_period).toBe(1);
    expect(res.projected_period_total).toBe(21 * 500);
  });

  it('on contract end_date: worked covers the full month, nothing remaining', () => {
    const res = computeAccrual({ contract: lf, leaveRows: [], today: '2026-03-31' });
    expect(res.period_start).toBe('2026-03-01');
    expect(res.period_end).toBe('2026-03-31');
    expect(res.worked_days_to_date).toBe(22);
    expect(res.worked_days_remaining).toBe(0);
    expect(res.projected_period_total).toBe(22 * 500);
  });

  it('today past contract end_date: clip is empty, everything zero', () => {
    const res = computeAccrual({ contract: lf, leaveRows: [], today: '2026-04-15' });
    expect(res.worked_days_to_date).toBe(0);
    expect(res.worked_days_remaining).toBe(0);
    expect(res.accrued_to_date).toBe(0);
    expect(res.projected_period_total).toBe(0);
  });
});

describe('computeAccrual — passthrough fields', () => {
  it('returns contract_id, day_rate and currency unchanged', () => {
    const res = computeAccrual({ contract: dc, leaveRows: [], today: '2026-04-15' });
    expect(res.contract_id).toBe('dc-sow-2026');
    expect(res.day_rate).toBe(550);
    expect(res.currency).toBe('GBP');
  });

  it('lf day_rate is £500', () => {
    const res = computeAccrual({ contract: lf, leaveRows: [], today: '2026-03-25' });
    expect(res.day_rate).toBe(500);
  });

  it('contract with zero weekday mask: worked/remaining are 0', () => {
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
    const res = computeAccrual({ contract: zeroMask, leaveRows: [], today: '2026-03-25' });
    expect(res.worked_days_to_date).toBe(0);
    expect(res.worked_days_remaining).toBe(0);
    expect(res.projected_period_total).toBe(0);
  });
});

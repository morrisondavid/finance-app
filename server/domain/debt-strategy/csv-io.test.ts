import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  PLANS_CSV_FILENAME,
  PLAN_CSV_HEADERS,
  getPlansCsvPath,
  parsePlanRow,
  readPlansCsvFile,
  writePlansCsvFile,
} from './csv-io.js';
import type { Plan } from './schema.js';

let tmpDir: string;
let csvPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-strategy-csv-test-'));
  csvPath = getPlansCsvPath(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makePlan(over: Partial<Plan> & Pick<Plan, 'id'>): Plan {
  return {
    id: over.id,
    display_name: over.display_name ?? `Plan ${over.id}`,
    goal_type: over.goal_type ?? 'pay-off-debt',
    target_id: over.target_id ?? 'funding-circle',
    target_amount: over.target_amount ?? null,
    target_account: over.target_account ?? 'barclays-current',
    target_date_or_asap: over.target_date_or_asap ?? 'ASAP',
    currency: over.currency ?? 'GBP',
    scope: over.scope ?? 'autonize-it-ltd',
    intensity: over.intensity ?? 'medium',
    monthly_allocation: over.monthly_allocation ?? 400,
    status: over.status ?? 'active',
    activated_at: over.activated_at ?? '2026-04-25',
    completed_at: over.completed_at ?? null,
    projected_completion_date: over.projected_completion_date ?? null,
    notes: over.notes ?? null,
    updated_at: over.updated_at ?? '2026-04-25',
  };
}

describe('CSV round-trip', () => {
  it('persists every column and reads it back identically', () => {
    const plans: Plan[] = [
      makePlan({
        id: 'plan-1',
        display_name: 'Clear Funding Circle',
        notes: 'Drawn down on Barclays',
        completed_at: null,
        projected_completion_date: '2027-05-15',
      }),
      makePlan({
        id: 'plan-2',
        display_name: 'Holiday Fund',
        goal_type: 'save-for-target',
        target_id: null,
        target_amount: 8000,
        target_account: 'natwest-savings',
        target_date_or_asap: '2026-07-01',
        scope: 'household',
        intensity: 'aggressive',
        monthly_allocation: 1000,
      }),
    ];
    writePlansCsvFile(csvPath, plans);
    const round = readPlansCsvFile(csvPath);
    expect(round).toHaveLength(2);
    expect(round.find(p => p.id === 'plan-1')).toEqual(plans[0]);
    expect(round.find(p => p.id === 'plan-2')).toEqual(plans[1]);
  });

  it('writes the canonical header row', () => {
    writePlansCsvFile(csvPath, []);
    const content = fs.readFileSync(csvPath, 'utf8');
    expect(content.startsWith(PLAN_CSV_HEADERS.join(',') + '\n')).toBe(true);
  });

  it('escapes commas and quotes in display_name and notes', () => {
    const p = makePlan({
      id: 'p1',
      display_name: 'Plan, with "comma" and quote',
      notes: 'Note "with" comma, here',
    });
    writePlansCsvFile(csvPath, [p]);
    const round = readPlansCsvFile(csvPath);
    expect(round[0].display_name).toBe('Plan, with "comma" and quote');
    expect(round[0].notes).toBe('Note "with" comma, here');
  });

  it('CSV writer FILTERS OUT status=suggested rows (regression lock — they must never persist)', () => {
    const plans: Plan[] = [
      makePlan({ id: 'p1', status: 'active' }),
      // Force a 'suggested' row in via type assertion to test the filter:
      { ...makePlan({ id: 'p2' }), status: 'suggested' as never } as Plan,
    ];
    writePlansCsvFile(csvPath, plans);
    const round = readPlansCsvFile(csvPath);
    expect(round.map(p => p.id)).toEqual(['p1']);
  });

  it('parsing a row with status=suggested throws (only persisted statuses are valid in the CSV)', () => {
    const row: Record<string, string> = {
      id: 'p1',
      display_name: 'Test',
      goal_type: 'pay-off-debt',
      target_id: 'funding-circle',
      target_amount: '',
      target_account: 'barclays-current',
      target_date_or_asap: 'ASAP',
      currency: 'GBP',
      scope: 'autonize-it-ltd',
      intensity: 'medium',
      monthly_allocation: '400',
      status: 'suggested',
      activated_at: '2026-04-25',
      completed_at: '',
      projected_completion_date: '',
      notes: '',
      updated_at: '2026-04-25',
    };
    expect(() => parsePlanRow(row)).toThrow(/suggested/);
  });

  it('returns [] when CSV does not exist', () => {
    expect(readPlansCsvFile(csvPath)).toEqual([]);
  });

  it('PLANS_CSV_FILENAME constant', () => {
    expect(PLANS_CSV_FILENAME).toBe('plans.csv');
  });
});

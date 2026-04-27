import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  MOVEMENTS_CSV_FILENAME,
  MOVEMENT_CSV_HEADERS,
  getMovementsCsvPath,
  readMovementsCsvFile,
  writeMovementsCsvFile,
} from './movements-csv-io.js';
import type { Movement } from './movements-schema.js';

let tmpDir: string;
let csvPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'movements-csv-test-'));
  csvPath = getMovementsCsvPath(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeMov(over: Partial<Movement> & Pick<Movement, 'id' | 'plan_id'>): Movement {
  return {
    id: over.id,
    plan_id: over.plan_id,
    from_account: over.from_account ?? 'natwest',
    to_account: over.to_account ?? 'barclays-current',
    amount: over.amount ?? 400,
    day_of_month: over.day_of_month ?? 1,
    expected_start_date: over.expected_start_date ?? '2026-05-01',
    expected_end_date: over.expected_end_date ?? null,
    acknowledged_at: over.acknowledged_at ?? null,
    dismissed_missed_until: over.dismissed_missed_until ?? null,
    updated_at: over.updated_at ?? '2026-04-25',
  };
}

describe('movements CSV round-trip', () => {
  it('persists every column and reads back identically', () => {
    const movs: Movement[] = [
      makeMov({
        id: 'm1',
        plan_id: 'plan-a',
        amount: 400,
        day_of_month: 1,
        acknowledged_at: '2026-04-26',
      }),
      makeMov({
        id: 'm2',
        plan_id: 'plan-a',
        amount: 100,
        day_of_month: 15,
        expected_end_date: '2027-05-01',
        dismissed_missed_until: '2026-06-01',
      }),
    ];
    writeMovementsCsvFile(csvPath, movs);
    const round = readMovementsCsvFile(csvPath);
    expect(round).toHaveLength(2);
    expect(round.find(m => m.id === 'm1')).toEqual(movs[0]);
    expect(round.find(m => m.id === 'm2')).toEqual(movs[1]);
  });

  it('writes the canonical header row', () => {
    writeMovementsCsvFile(csvPath, []);
    const content = fs.readFileSync(csvPath, 'utf8');
    expect(content.startsWith(MOVEMENT_CSV_HEADERS.join(',') + '\n')).toBe(true);
  });

  it('preserves acknowledged_at across DB-rebuild round-trip (canonical user input)', () => {
    const m: Movement = makeMov({
      id: 'm1',
      plan_id: 'plan-a',
      acknowledged_at: '2026-05-15',
    });
    writeMovementsCsvFile(csvPath, [m]);
    const round = readMovementsCsvFile(csvPath);
    expect(round[0].acknowledged_at).toBe('2026-05-15');
  });

  it('preserves dismissed_missed_until across round-trip', () => {
    const m: Movement = makeMov({
      id: 'm1',
      plan_id: 'plan-a',
      dismissed_missed_until: '2026-08-01',
    });
    writeMovementsCsvFile(csvPath, [m]);
    const round = readMovementsCsvFile(csvPath);
    expect(round[0].dismissed_missed_until).toBe('2026-08-01');
  });

  it('returns [] when CSV does not exist', () => {
    expect(readMovementsCsvFile(csvPath)).toEqual([]);
  });

  it('MOVEMENTS_CSV_FILENAME constant', () => {
    expect(MOVEMENTS_CSV_FILENAME).toBe('movements.csv');
  });
});

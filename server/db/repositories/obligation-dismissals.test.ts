import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Tests for the obligation-dismissals repository.
 *
 * We point the real module at an in-memory SQLite + a temp dir for the CSV
 * via a vi.mock on ../connection.js so every CRUD path — including the
 * file-sync side-effect — runs end-to-end.
 */

let testDb: Database.Database;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obligation-dismissals-repo-test-'));

vi.mock('../connection.js', () => ({
  getDb: () => testDb,
  OBLIGATIONS_DIR: tmpDir,
}));

// Import after vi.mock so the repo uses the mocked connection.
const {
  addDismissal,
  removeDismissal,
  isDismissed,
  listDismissals,
  getDismissal,
  loadDismissalsFromCsv,
  isAutoObligationId,
  NonAutoDismissalError,
} = await import('./obligation-dismissals.js');

const { getObligationDismissalsCsvPath } = await import('../obligation-dismissals-csv.js');

function createSchema(): void {
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS obligation_dismissals (
      obligation_id TEXT PRIMARY KEY,
      reason TEXT,
      dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

beforeAll(() => {
  testDb = new Database(':memory:');
  createSchema();
});

afterAll(() => {
  testDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  testDb.exec('DELETE FROM obligation_dismissals');
  const csv = getObligationDismissalsCsvPath(tmpDir);
  if (fs.existsSync(csv)) fs.unlinkSync(csv);
});

describe('isAutoObligationId', () => {
  it('accepts auto-prefixed ids', () => {
    expect(isAutoObligationId('auto-sa-david-2026-01-31')).toBe(true);
    expect(isAutoObligationId('auto-vat-2025-05-01')).toBe(true);
  });

  it('rejects ids without the auto- prefix', () => {
    expect(isAutoObligationId('manual-123')).toBe(false);
    expect(isAutoObligationId('sa-david-2026-01-31')).toBe(false);
    expect(isAutoObligationId('')).toBe(false);
  });
});

describe('addDismissal', () => {
  it('persists a dismissal and returns it', () => {
    const saved = addDismissal({ obligationId: 'auto-sa-david-2026-01-31', reason: 'Non-resident' });
    expect(saved.obligationId).toBe('auto-sa-david-2026-01-31');
    expect(saved.reason).toBe('Non-resident');
    expect(typeof saved.dismissedAt).toBe('string');
    expect(saved.dismissedAt.length).toBeGreaterThan(0);
  });

  it('upserts when the same id is dismissed twice (new reason overwrites)', () => {
    addDismissal({ obligationId: 'auto-vat-2025-05-01', reason: 'first' });
    const updated = addDismissal({ obligationId: 'auto-vat-2025-05-01', reason: 'second' });
    expect(updated.reason).toBe('second');
    expect(listDismissals()).toHaveLength(1);
  });

  it('allows omitting reason', () => {
    const saved = addDismissal({ obligationId: 'auto-vat-2025-05-01' });
    expect(saved.reason).toBeNull();
  });

  it('rejects non-auto ids with NonAutoDismissalError', () => {
    expect(() => addDismissal({ obligationId: 'manual-123' })).toThrow(NonAutoDismissalError);
    expect(() => addDismissal({ obligationId: 'sa-david-2026-01-31' })).toThrow(NonAutoDismissalError);
  });

  it('writes dismissals to the canonical CSV', () => {
    addDismissal({ obligationId: 'auto-sa-heena-2026-07-31', reason: 'nil return' });
    const csv = fs.readFileSync(getObligationDismissalsCsvPath(tmpDir), 'utf8');
    expect(csv).toContain('auto-sa-heena-2026-07-31');
    expect(csv).toContain('nil return');
  });
});

describe('isDismissed', () => {
  it('returns true after a dismissal is added', () => {
    addDismissal({ obligationId: 'auto-sa-david-2026-01-31' });
    expect(isDismissed('auto-sa-david-2026-01-31')).toBe(true);
  });

  it('returns false for unknown ids', () => {
    expect(isDismissed('auto-sa-david-2027-01-31')).toBe(false);
  });
});

describe('removeDismissal', () => {
  it('deletes the row and returns true', () => {
    addDismissal({ obligationId: 'auto-vat-2025-05-01' });
    expect(removeDismissal('auto-vat-2025-05-01')).toBe(true);
    expect(isDismissed('auto-vat-2025-05-01')).toBe(false);
  });

  it('returns false when the id does not exist', () => {
    expect(removeDismissal('auto-vat-missing')).toBe(false);
  });

  it('syncs the CSV after delete', () => {
    addDismissal({ obligationId: 'auto-sa-david-2026-01-31' });
    addDismissal({ obligationId: 'auto-vat-2025-05-01' });
    removeDismissal('auto-vat-2025-05-01');
    const csv = fs.readFileSync(getObligationDismissalsCsvPath(tmpDir), 'utf8');
    expect(csv).toContain('auto-sa-david-2026-01-31');
    expect(csv).not.toContain('auto-vat-2025-05-01');
  });
});

describe('getDismissal / listDismissals', () => {
  it('getDismissal returns null for unknown id', () => {
    expect(getDismissal('auto-sa-david-2099-01-31')).toBeNull();
  });

  it('listDismissals returns every persisted dismissal', () => {
    addDismissal({ obligationId: 'auto-sa-david-2026-01-31' });
    addDismissal({ obligationId: 'auto-vat-2025-05-01' });
    expect(listDismissals().map(d => d.obligationId).sort()).toEqual([
      'auto-sa-david-2026-01-31',
      'auto-vat-2025-05-01',
    ]);
  });
});

describe('loadDismissalsFromCsv', () => {
  it('restores dismissals from the CSV on startup', () => {
    addDismissal({ obligationId: 'auto-sa-david-2026-01-31', reason: 'Dubai' });
    addDismissal({ obligationId: 'auto-vat-2025-05-01' });

    testDb.exec('DELETE FROM obligation_dismissals');
    expect(listDismissals()).toHaveLength(0);

    loadDismissalsFromCsv();

    const restored = listDismissals();
    expect(restored).toHaveLength(2);
    const sa = restored.find(r => r.obligationId === 'auto-sa-david-2026-01-31');
    expect(sa?.reason).toBe('Dubai');
  });
});

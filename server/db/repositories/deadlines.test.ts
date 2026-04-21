import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  createInMemoryTestDb,
  resetTestData,
  type TestDbHandles,
} from '../test-harness/in-memory-db.js';

/**
 * Regression-lock the deadlines repository. Every mutation path has to
 * round-trip back through the CSV (single source of truth) — a bug that
 * only shows up on a server restart would otherwise ship unnoticed.
 */
const harness: { current: TestDbHandles | null } = { current: null };

vi.mock('../connection.js', () => ({
  getDb: () => {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.db;
  },
  get DEADLINES_DIR() {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.deadlinesDir;
  },
}));

import {
  createDeadline,
  getAllDeadlines,
  getDeadline,
  updateDeadline,
  deleteDeadline,
  markDeadlineDone,
  unmarkDeadlineDone,
  loadDeadlinesFromCsv,
  exportDeadlinesFromDbToFile,
} from './deadlines.js';
import {
  getDeadlinesCsvPath,
  readDeadlinesFromCsvFile,
} from '../../domain/deadlines/deadlines-csv.js';

describe('deadlines repository', () => {
  beforeAll(() => {
    harness.current = createInMemoryTestDb();
  });

  afterAll(() => {
    harness.current?.cleanup();
  });

  beforeEach(() => {
    if (harness.current) resetTestData(harness.current.db);
  });

  it('createDeadline stores every field and re-exports CSV', () => {
    const d = createDeadline({
      id: 'ch-2026',
      type: 'companies-house',
      title: 'Confirmation statement',
      dueDate: '2026-11-01',
      recurrence: 'annual',
      notes: 'File via WebFiling',
      url: 'https://gov.uk',
    });
    expect(d.id).toBe('ch-2026');
    expect(d.completedDate).toBeNull();

    const csv = readDeadlinesFromCsvFile(
      getDeadlinesCsvPath(harness.current!.deadlinesDir),
    );
    expect(csv).toHaveLength(1);
    expect(csv[0].title).toBe('Confirmation statement');
  });

  it('createDeadline auto-generates an id when none provided', () => {
    const d = createDeadline({
      type: 'other',
      title: 'Random',
      dueDate: '2026-06-01',
      recurrence: 'one-off',
    });
    expect(d.id).toMatch(/^dl-[0-9a-f]{8}$/);
  });

  it('createDeadline rejects duplicate ids', () => {
    createDeadline({
      id: 'dup',
      type: 'other',
      title: 'First',
      dueDate: '2026-01-01',
      recurrence: 'one-off',
    });
    expect(() =>
      createDeadline({
        id: 'dup',
        type: 'other',
        title: 'Second',
        dueDate: '2026-02-01',
        recurrence: 'one-off',
      }),
    ).toThrow(/already exists/);
  });

  it('createDeadline rejects invalid slug ids', () => {
    expect(() =>
      createDeadline({
        id: 'Bad Id With Spaces',
        type: 'other',
        title: 'x',
        dueDate: '2026-01-01',
        recurrence: 'one-off',
      }),
    ).toThrow(/slug/);
  });

  it('updateDeadline patches partial fields and bumps updatedAt', async () => {
    const created = createDeadline({
      id: 'to-edit',
      type: 'other',
      title: 'Original',
      dueDate: '2026-01-01',
      recurrence: 'one-off',
    });
    await new Promise(r => setTimeout(r, 5));
    const updated = updateDeadline('to-edit', { title: 'Edited' });
    expect(updated.title).toBe('Edited');
    expect(updated.dueDate).toBe('2026-01-01');
    expect(updated.updatedAt).not.toBe(created.updatedAt);
  });

  it('deleteDeadline removes the row and the CSV entry', () => {
    createDeadline({
      id: 'goner',
      type: 'other',
      title: 'Gone',
      dueDate: '2026-01-01',
      recurrence: 'one-off',
    });
    expect(deleteDeadline('goner')).toBe(true);
    expect(getDeadline('goner')).toBeNull();
    const csv = readDeadlinesFromCsvFile(
      getDeadlinesCsvPath(harness.current!.deadlinesDir),
    );
    expect(csv).toEqual([]);
  });

  it('deleteDeadline returns false when id is unknown', () => {
    expect(deleteDeadline('nope')).toBe(false);
  });

  it('markDeadlineDone / unmarkDeadlineDone round-trip', () => {
    createDeadline({
      id: 'toggle',
      type: 'other',
      title: 'Toggle me',
      dueDate: '2026-01-01',
      recurrence: 'one-off',
    });
    const done = markDeadlineDone('toggle', '2026-01-05');
    expect(done?.completedDate).toBe('2026-01-05');
    const reopened = unmarkDeadlineDone('toggle');
    expect(reopened?.completedDate).toBeNull();
  });

  it('markDeadlineDone returns null for unknown id', () => {
    expect(markDeadlineDone('missing')).toBeNull();
    expect(unmarkDeadlineDone('missing')).toBeNull();
  });

  it('loadDeadlinesFromCsv rebuilds the DB projection', () => {
    createDeadline({
      id: 'a',
      type: 'other',
      title: 'A',
      dueDate: '2026-01-01',
      recurrence: 'one-off',
    });
    createDeadline({
      id: 'b',
      type: 'other',
      title: 'B',
      dueDate: '2026-02-01',
      recurrence: 'one-off',
    });

    // Wipe the DB and reload from the CSV left by createDeadline
    harness.current!.db.exec('DELETE FROM deadlines');
    loadDeadlinesFromCsv();

    const rows = getAllDeadlines();
    expect(rows.map(r => r.id).sort()).toEqual(['a', 'b']);
  });

  it('exportDeadlinesFromDbToFile snapshots current DB state', () => {
    createDeadline({
      id: 'x',
      type: 'other',
      title: 'X',
      dueDate: '2026-03-01',
      recurrence: 'one-off',
    });
    harness.current!.db
      .prepare("UPDATE deadlines SET title = ? WHERE id = 'x'")
      .run('Direct write');
    exportDeadlinesFromDbToFile();
    const [csvRow] = readDeadlinesFromCsvFile(
      getDeadlinesCsvPath(harness.current!.deadlinesDir),
    );
    expect(csvRow.title).toBe('Direct write');
  });

  it('getAllDeadlines sorts by due date ascending', () => {
    createDeadline({ id: 'late', type: 'other', title: 'late', dueDate: '2027-01-01', recurrence: 'one-off' });
    createDeadline({ id: 'early', type: 'other', title: 'early', dueDate: '2026-01-01', recurrence: 'one-off' });
    createDeadline({ id: 'mid', type: 'other', title: 'mid', dueDate: '2026-06-01', recurrence: 'one-off' });
    expect(getAllDeadlines().map(d => d.id)).toEqual(['early', 'mid', 'late']);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  fingerprintWarning,
  recordSnapshot,
  loadSnapshot,
  findPreviousSnapshotAt,
  diffAgainstPreviousSnapshot,
  trimSnapshotsBefore,
} from './snapshots.js';
import type {
  EntityFoundationWarning,
  WarningSeverity,
} from '../../../shared/api-contracts.js';

function makeWarning(over: Partial<EntityFoundationWarning> = {}): EntityFoundationWarning {
  return {
    id: 'w1',
    code: 'company-tbc-fields',
    severity: 'warn',
    title: 'Sample warning',
    detail: 'Sample detail',
    recommended_action: 'Sample action',
    sources: ['source:a'],
    ...over,
  };
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE warning_snapshots (
      snapshot_at TEXT NOT NULL,
      warning_id TEXT NOT NULL,
      code TEXT NOT NULL,
      severity TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      entity_id TEXT,
      title TEXT NOT NULL
    );
    CREATE INDEX idx_ws_at ON warning_snapshots(snapshot_at);
    CREATE INDEX idx_ws_fp ON warning_snapshots(fingerprint);
  `);
  return db;
}

describe('fingerprintWarning', () => {
  it('returns the same hash for the same identity (different id, different prose)', () => {
    const a = makeWarning({ id: 'a', title: 'a-title', detail: 'a-detail' });
    const b = makeWarning({ id: 'b', title: 'b-title', detail: 'b-detail' });
    expect(fingerprintWarning(a)).toBe(fingerprintWarning(b));
  });

  it('returns the same hash when severity is the only thing that changed', () => {
    const before = makeWarning({ severity: 'critical' });
    const after = makeWarning({ severity: 'warn' });
    expect(fingerprintWarning(before)).toBe(fingerprintWarning(after));
  });

  it('returns different hashes for different codes', () => {
    const a = makeWarning({ code: 'company-tbc-fields' });
    const b = makeWarning({ code: 'client-tbc-fields' });
    expect(fingerprintWarning(a)).not.toBe(fingerprintWarning(b));
  });

  it('returns different hashes when context primitives differ', () => {
    const a = makeWarning({ context: { ratio: 0.5 } });
    const b = makeWarning({ context: { ratio: 0.6 } });
    expect(fingerprintWarning(a)).not.toBe(fingerprintWarning(b));
  });

  it('seed-spanning fingerprint uniqueness', () => {
    const codes = [
      'company-tbc-fields',
      'client-tbc-fields',
      'contract-ending-soon',
      'fzco-ct-status-unknown',
      'fzco-vat-voluntary-threshold-crossed',
      'runway-low',
      'time-independence-low',
      'leveraged-passive-income',
      'tax-reserve-underfunded',
      'tax-reserve-trajectory-missing',
      'tax-reserve-pool-underfunded',
      'ad-hoc-spend-escalating',
    ] as const;
    const seen = new Set<string>();
    for (const code of codes) {
      const fp = fingerprintWarning(makeWarning({ code, sources: [`source:${code}`] }));
      expect(seen.has(fp), `Collision for ${code}`).toBe(false);
      seen.add(fp);
    }
    expect(seen.size).toBe(codes.length);
  });

  it('order-insensitive on sources', () => {
    const a = makeWarning({ sources: ['a', 'b'] });
    const b = makeWarning({ sources: ['b', 'a'] });
    expect(fingerprintWarning(a)).toBe(fingerprintWarning(b));
  });

  it('order-insensitive on context keys', () => {
    const a = makeWarning({ context: { ratio: 0.5, total: 100 } });
    const b = makeWarning({ context: { total: 100, ratio: 0.5 } });
    expect(fingerprintWarning(a)).toBe(fingerprintWarning(b));
  });
});

describe('recordSnapshot + loadSnapshot', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = setupDb();
  });

  it('persists every warning at the same snapshotAt', () => {
    recordSnapshot(db, '2026-01-01T00:00:00Z', [
      makeWarning({ id: 'a', code: 'company-tbc-fields' }),
      makeWarning({ id: 'b', code: 'client-tbc-fields', sources: ['source:b'] }),
    ]);
    const rows = loadSnapshot(db, '2026-01-01T00:00:00Z');
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.warningId).sort()).toEqual(['a', 'b']);
  });

  it('is a no-op for an empty array', () => {
    recordSnapshot(db, '2026-01-01T00:00:00Z', []);
    expect(loadSnapshot(db, '2026-01-01T00:00:00Z')).toHaveLength(0);
  });
});

describe('findPreviousSnapshotAt', () => {
  it('returns the most recent snapshot strictly older than `before`', () => {
    const db = setupDb();
    recordSnapshot(db, '2026-01-01T00:00:00Z', [makeWarning()]);
    recordSnapshot(db, '2026-01-05T00:00:00Z', [makeWarning()]);
    expect(findPreviousSnapshotAt(db, '2026-01-10T00:00:00Z')).toBe('2026-01-05T00:00:00Z');
  });

  it('returns null when nothing is older', () => {
    const db = setupDb();
    expect(findPreviousSnapshotAt(db, '2026-01-01T00:00:00Z')).toBeNull();
  });
});

describe('diffAgainstPreviousSnapshot', () => {
  it('emits warning-cleared for fingerprints in the snapshot but not in current', () => {
    const previous = [
      {
        snapshotAt: '2026-01-01T00:00:00Z',
        warningId: 'old-id',
        code: 'company-tbc-fields',
        severity: 'critical' as WarningSeverity,
        fingerprint: fingerprintWarning(makeWarning({ code: 'company-tbc-fields' })),
        entityId: null,
        title: 'Original title',
      },
    ];
    const out = diffAgainstPreviousSnapshot({
      now: '2026-01-08T00:00:00Z',
      currentWarnings: [],
      previousSnapshot: previous,
      previousSnapshotAt: '2026-01-01T00:00:00Z',
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('warning-cleared');
    expect(out[0].severity).toBe('info');
    expect(out[0].context?.originalCode).toBe('company-tbc-fields');
    expect(out[0].context?.previousSeverity).toBe('critical');
  });

  it('emits warning-improved when severity drops between snapshots', () => {
    const fp = fingerprintWarning(makeWarning({ code: 'time-independence-low' }));
    const previous = [
      {
        snapshotAt: '2026-01-01T00:00:00Z',
        warningId: 'p1',
        code: 'time-independence-low',
        severity: 'critical' as WarningSeverity,
        fingerprint: fp,
        entityId: null,
        title: 'Time-independence is low',
      },
    ];
    const out = diffAgainstPreviousSnapshot({
      now: '2026-01-08T00:00:00Z',
      currentWarnings: [makeWarning({ code: 'time-independence-low', severity: 'warn' })],
      previousSnapshot: previous,
      previousSnapshotAt: '2026-01-01T00:00:00Z',
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('warning-improved');
    expect(out[0].severity).toBe('info');
    expect(out[0].context?.previousSeverity).toBe('critical');
    expect(out[0].context?.currentSeverity).toBe('warn');
  });

  it('does not emit when severity is unchanged', () => {
    const fp = fingerprintWarning(makeWarning({ code: 'company-tbc-fields' }));
    const previous = [
      {
        snapshotAt: '2026-01-01T00:00:00Z',
        warningId: 'p1',
        code: 'company-tbc-fields',
        severity: 'warn' as WarningSeverity,
        fingerprint: fp,
        entityId: null,
        title: 'TBC',
      },
    ];
    const out = diffAgainstPreviousSnapshot({
      now: '2026-01-08T00:00:00Z',
      currentWarnings: [makeWarning({ code: 'company-tbc-fields', severity: 'warn' })],
      previousSnapshot: previous,
      previousSnapshotAt: '2026-01-01T00:00:00Z',
    });
    expect(out).toHaveLength(0);
  });

  it('does not emit when severity rises (regression handled by the underlying signal)', () => {
    const fp = fingerprintWarning(makeWarning({ code: 'company-tbc-fields' }));
    const previous = [
      {
        snapshotAt: '2026-01-01T00:00:00Z',
        warningId: 'p1',
        code: 'company-tbc-fields',
        severity: 'warn' as WarningSeverity,
        fingerprint: fp,
        entityId: null,
        title: 'TBC',
      },
    ];
    const out = diffAgainstPreviousSnapshot({
      now: '2026-01-08T00:00:00Z',
      currentWarnings: [makeWarning({ code: 'company-tbc-fields', severity: 'critical' })],
      previousSnapshot: previous,
      previousSnapshotAt: '2026-01-01T00:00:00Z',
    });
    expect(out).toHaveLength(0);
  });

  it('first-run boundary: empty previous snapshot → no diff entries', () => {
    const out = diffAgainstPreviousSnapshot({
      now: '2026-01-08T00:00:00Z',
      currentWarnings: [makeWarning(), makeWarning({ code: 'client-tbc-fields' })],
      previousSnapshot: [],
      previousSnapshotAt: '2026-01-01T00:00:00Z',
    });
    expect(out).toHaveLength(0);
  });
});

describe('trimSnapshotsBefore', () => {
  it('drops rows older than the cutoff', () => {
    const db = setupDb();
    recordSnapshot(db, '2025-01-01T00:00:00Z', [makeWarning({ id: 'a' })]);
    recordSnapshot(db, '2026-01-01T00:00:00Z', [makeWarning({ id: 'b' })]);
    const dropped = trimSnapshotsBefore(db, '2026-01-01T00:00:00Z');
    expect(dropped).toBe(1);
    expect(loadSnapshot(db, '2025-01-01T00:00:00Z')).toHaveLength(0);
    expect(loadSnapshot(db, '2026-01-01T00:00:00Z')).toHaveLength(1);
  });
});

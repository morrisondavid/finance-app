import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { EntityFoundationWarning } from '../../../shared/api-contracts.js';
import { fingerprintWarning } from './snapshots.js';
import {
  actionHintsForWarningCode,
  enrichWarningsForAgents,
  extractWarningLinks,
  warningPassesListingFilter,
} from './enrich-for-agents.js';

function makeWarning(over: Partial<EntityFoundationWarning> = {}): EntityFoundationWarning {
  return {
    id: 'w1',
    code: 'company-tbc-fields',
    severity: 'warn',
    title: 'Sample',
    detail: 'Sample detail',
    recommended_action: 'Act',
    sources: ['a'],
    ...over,
  };
}

function memDb(): Database.Database {
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
  `);
  return db;
}

describe('enrich-for-agents', () => {
  it('fingerprint matches fingerprintWarning on base fields (strips prior enrich keys)', () => {
    const db = memDb();
    const base = makeWarning({
      context: { invoiceId: 'inv-1' },
    });
    const dirty = { ...base, fingerprint: 'deadbeef', links: { invoiceId: 'wrong' } };
    const [out] = enrichWarningsForAgents(db, [dirty], new Map());
    expect(out.fingerprint).toBe(fingerprintWarning(base));
  });

  it('extractWarningLinks pulls structured ids from context', () => {
    const w = makeWarning({
      context: {
        contractId: 'c1',
        obligationId: 'o1',
        invoiceId: 'i1',
        debtId: 'd1',
        planId: 'p1',
        movementId: 'm1',
      },
    });
    expect(extractWarningLinks(w)).toEqual({
      obligationId: 'o1',
      contractId: 'c1',
      invoiceId: 'i1',
      debtId: 'd1',
      planId: 'p1',
      movementId: 'm1',
    });
  });

  it('merges userState from fingerprint map', () => {
    const db = memDb();
    const w = makeWarning();
    const fp = fingerprintWarning(w);
    const userMap = new Map([[fp, { snoozedUntil: '2099-01-01', surface: 'dashboard' as const }]]);
    const [out] = enrichWarningsForAgents(db, [w], userMap);
    expect(out.fingerprint).toBe(fp);
    expect(out.userState).toEqual({ snoozedUntil: '2099-01-01', surface: 'dashboard' });
  });

  it('warningPassesListingFilter hides active snoozes by ISO date', () => {
    const snoozed = makeWarning({
      userState: { snoozedUntil: '2026-05-06' },
    });
    expect(warningPassesListingFilter(snoozed, '2026-05-06')).toBe(false);
    expect(warningPassesListingFilter(snoozed, '2026-05-07')).toBe(true);
  });

  it('warningPassesListingFilter hides snapshot-diff meta entries', () => {
    const cleared = makeWarning({
      code: 'warning-cleared',
      severity: 'info',
      title: 'Cleared: Deposit on 2026-02-18 did not match any invoice',
    });
    const improved = makeWarning({
      code: 'warning-improved',
      severity: 'info',
      title: 'Improved: Runway low',
    });
    expect(warningPassesListingFilter(cleared, '2026-06-06')).toBe(false);
    expect(warningPassesListingFilter(improved, '2026-06-06')).toBe(false);
  });

  it('actionHintsForWarningCode maps runway prefix', () => {
    expect(actionHintsForWarningCode('runway-low')).toContain('review_runway_forecast');
  });
});
